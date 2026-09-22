/*
Name: Naman Agrawal
This is room-select.js. It shows the rooms a logged-in user belongs to,
and handles creating a new room or joining one with an invite code.
*/
window.onload = async function () {
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

    function enterRoom(roomId, roomName) {
        localStorage.setItem("currentRoomId", roomId);
        localStorage.setItem("currentRoomName", roomName);
        window.location.href = "index.html";
    }

    async function loadRooms() {
        roomListDiv.innerHTML = "<p>Loading your rooms...</p>";

        const { data, error } = await supabaseClient
            .from("room_members")
            .select("role, rooms(id, name, status, invite_code)")
            .eq("user_id", user.id)
            .eq("is_active", true);

        if (error) {
            roomListDiv.innerHTML = "<p>Something went wrong loading your rooms. Try refreshing.</p>";
            return;
        }

        if (!data || data.length === 0) {
            roomListDiv.innerHTML =
                "<p>You're not in any rooms yet. Create one or join with a code below.</p>";
            return;
        }

        roomListDiv.innerHTML = "";
        for (let i = 0; i < data.length; i++) {
            const membership = data[i];
            const room = membership.rooms;
            if (!room) {
                continue;
            }

            const roomDiv = document.createElement("div");
            roomDiv.className = "room-entry";
            roomDiv.innerHTML =
                "<h3>" +
                room.name +
                "</h3>" +
                "<p>Status: " +
                room.status +
                "</p>" +
                (membership.role === "owner"
                    ? "<p>Invite code: <strong>" + room.invite_code + "</strong></p>"
                    : "") +
                "<button class='enter-room-btn' data-id='" +
                room.id +
                "' data-name='" +
                room.name +
                "'>Enter Room</button>";
            roomListDiv.appendChild(roomDiv);
        }

        const enterButtons = document.getElementsByClassName("enter-room-btn");
        for (let i = 0; i < enterButtons.length; i++) {
            enterButtons[i].addEventListener("click", function () {
                enterRoom(this.getAttribute("data-id"), this.getAttribute("data-name"));
            });
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
            createError.innerHTML = "<p>" + error.message + "</p>";
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
            joinError.innerHTML = "<p>" + error.message + "</p>";
            return;
        }

        if (!data || data.length === 0) {
            joinError.innerHTML = "<p>That room code wasn't found.</p>";
            return;
        }

        enterRoom(data[0].id, data[0].name);
    });

    loadRooms();
};
