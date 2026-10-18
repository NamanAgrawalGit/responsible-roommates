/*
Name: Naman Agrawal
This is room-select.js. It shows the rooms a logged-in user belongs to,
and handles creating a new room or joining one with an invite code. It
also detects when the page was just reached via an email confirmation
link (Supabase appends "type=signup" to the URL hash in that case) and
shows a one-time banner, then cleans the token out of the address bar.
*/
window.onload = async function () {
    const confirmationBanner = document.getElementById("confirmation-banner");
    const hashParams = new URLSearchParams(window.location.hash.replace("#", "?"));

    if (hashParams.get("type") === "signup") {
        confirmationBanner.innerHTML =
            "<div class='confirmed-banner'>✅ Your email is confirmed! Welcome to Responsible Roommates.</div>";
        // Strip the access token etc. out of the visible URL/history now
        // that Supabase has already used it to create the session.
        window.history.replaceState(null, "", window.location.pathname);
    }

    const {
        data: { user },
    } = await supabaseClient.auth.getUser();

    const roomListDiv = document.getElementById("room-list");
    const createNameInput = document.getElementById("create-room-name");
    const createAddressInput = document.getElementById("create-room-address");
    const createMoveInInput = document.getElementById("create-room-movein");
    const createBtn = document.getElementById("create-room-btn");
    const createError = document.getElementById("create-room-error");
    const joinCodeInput = document.getElementById("join-room-code");
    const joinBtn = document.getElementById("join-room-btn");
    const joinError = document.getElementById("join-room-error");
    const myRequestsDiv = document.getElementById("my-join-requests");

    function enterRoom(roomId, roomName) {
        localStorage.setItem("currentRoomId", roomId);
        localStorage.setItem("currentRoomName", roomName);
        window.location.href = "index.html";
    }

    // Shows a join result using textContent so room names and server
    // messages are never interpreted as HTML. If an "enter room" target
    // is given, adds a button to go straight into that room.
    function showJoinMessage(message, isInfo, roomId, roomName) {
        joinError.innerHTML = "";
        const p = document.createElement("p");
        p.textContent = message;
        if (isInfo) {
            p.className = "info-message";
        }
        joinError.appendChild(p);

        if (roomId) {
            const btn = document.createElement("button");
            btn.textContent = "Enter Room";
            btn.addEventListener("click", function () {
                enterRoom(roomId, roomName);
            });
            joinError.appendChild(btn);
        }
    }

    function showRoomListMessage(text) {
        roomListDiv.innerHTML = "";
        const p = document.createElement("p");
        p.textContent = text;
        roomListDiv.appendChild(p);
    }

    function buildRoomEntry(membership, room, pendingCount) {
        const roomDiv = document.createElement("div");
        roomDiv.className = "room-entry";

        const title = document.createElement("h3");
        title.textContent = room.name;
        roomDiv.appendChild(title);

        const status = document.createElement("p");
        status.textContent = "Status: " + room.status;
        roomDiv.appendChild(status);

        if (membership.role === "owner") {
            const code = document.createElement("p");
            code.appendChild(document.createTextNode("Invite code: "));
            const strong = document.createElement("strong");
            strong.textContent = room.invite_code;
            code.appendChild(strong);
            roomDiv.appendChild(code);

            if (pendingCount > 0) {
                const note = document.createElement("p");
                note.className = "pending-note";
                note.textContent =
                    "\u23f3 " +
                    pendingCount +
                    (pendingCount === 1
                        ? " person is waiting to join."
                        : " people are waiting to join.") +
                    " Enter the room and open the bell to review.";
                roomDiv.appendChild(note);
            }
        }

        const btn = document.createElement("button");
        btn.className = "enter-room-btn";
        btn.textContent = "Enter Room";
        btn.addEventListener("click", function () {
            enterRoom(room.id, room.name);
        });
        roomDiv.appendChild(btn);

        return roomDiv;
    }

    async function loadRooms(silent) {
        if (!silent) {
            showRoomListMessage("Loading your rooms...");
        }

        const { data, error } = await supabaseClient
            .from("room_members")
            .select("role, rooms(id, name, status, invite_code)")
            .eq("user_id", user.id)
            .eq("is_active", true);

        if (error) {
            showRoomListMessage("Something went wrong loading your rooms. Try refreshing.");
            return;
        }

        if (!data || data.length === 0) {
            showRoomListMessage(
                "You're not in any rooms yet. Create one or join with a code below."
            );
            return;
        }

        // How many join requests are waiting on rooms I own?
        const ownedRoomIds = [];
        for (let i = 0; i < data.length; i++) {
            if (data[i].role === "owner" && data[i].rooms) {
                ownedRoomIds.push(data[i].rooms.id);
            }
        }

        const pendingCounts = {};
        if (ownedRoomIds.length > 0) {
            const { data: pending, error: pendingError } = await supabaseClient
                .from("room_join_requests")
                .select("room_id")
                .eq("status", "pending")
                .in("room_id", ownedRoomIds);

            if (pendingError) {
                console.error("Could not load join requests:", pendingError);
            } else {
                for (let i = 0; i < pending.length; i++) {
                    pendingCounts[pending[i].room_id] =
                        (pendingCounts[pending[i].room_id] || 0) + 1;
                }
            }
        }

        roomListDiv.innerHTML = "";
        for (let i = 0; i < data.length; i++) {
            const membership = data[i];
            const room = membership.rooms;
            if (!room) {
                continue;
            }
            roomListDiv.appendChild(
                buildRoomEntry(membership, room, pendingCounts[room.id] || 0)
            );
        }
    }

    // Rooms I've asked to join and am still waiting on (or was denied for).
    async function loadMyRequests() {
        const { data, error } = await supabaseClient.rpc("my_join_requests");

        if (error) {
            console.error("Could not load your join requests:", error);
            return;
        }

        myRequestsDiv.innerHTML = "";
        if (!data || data.length === 0) {
            return;
        }

        const heading = document.createElement("h3");
        heading.textContent = "Your Join Requests";
        myRequestsDiv.appendChild(heading);

        for (let i = 0; i < data.length; i++) {
            const entry = document.createElement("div");
            entry.className = "join-request-entry";
            const p = document.createElement("p");
            if (data[i].request_status === "pending") {
                p.textContent =
                    "\u23f3 Waiting for the owner of \"" +
                    data[i].room_name +
                    "\" to approve your request.";
            } else {
                p.textContent =
                    "\u274c The owner of \"" +
                    data[i].room_name +
                    "\" denied your request.";
            }
            entry.appendChild(p);
            myRequestsDiv.appendChild(entry);
        }
    }

    createBtn.addEventListener("click", async function () {
        const name = createNameInput.value.trim();
        const address = createAddressInput.value.trim();
        const moveIn = createMoveInInput.value;

        createError.innerHTML = "";

        if (name === "") {
            createError.innerHTML = "<p>Room name is required.</p>";
            return;
        }

        createBtn.disabled = true;

        const { data, error } = await supabaseClient
            .from("rooms")
            .insert({
                name: name,
                address: address === "" ? null : address,
                move_in_date: moveIn === "" ? null : moveIn,
                created_by: user.id,
            })
            .select()
            .single();

        createBtn.disabled = false;

        if (error) {
            createError.innerHTML = "";
            const errP = document.createElement("p");
            errP.textContent = error.message;
            createError.appendChild(errP);
            return;
        }

        enterRoom(data.id, data.name);
    });

    joinBtn.addEventListener("click", async function () {
        const code = joinCodeInput.value.trim();

        joinError.innerHTML = "";

        if (code === "") {
            joinError.innerHTML = "<p>Enter a room code.</p>";
            return;
        }

        joinBtn.disabled = true;

        const { data, error } = await supabaseClient.rpc("join_room_by_code", {
            invite_code_input: code,
        });

        joinBtn.disabled = false;

        if (error) {
            showJoinMessage(error.message, false);
            return;
        }

        if (!data || data.length === 0) {
            showJoinMessage("That room code wasn't found.", false);
            return;
        }

        if (data[0].already_member) {
            showJoinMessage(
                "You're already part of \"" + data[0].name + "\".",
                true,
                data[0].id,
                data[0].name
            );
            return;
        }

        if (data[0].request_pending) {
            joinCodeInput.value = "";
            showJoinMessage(
                "Request sent! The owner of \"" +
                    data[0].name +
                    "\" needs to approve it before you can enter.",
                true
            );
            loadMyRequests();
            return;
        }

        enterRoom(data[0].id, data[0].name);
    });

    loadRooms();
    loadMyRequests();

    // Check again every 30 seconds so an approved room shows up (and owners
    // see new requests) without a manual refresh.
    setInterval(function () {
        loadRooms(true);
        loadMyRequests();
    }, 30000);
};