/*
Name: Naman Agrawal
This is notifications.js. It loads the signed-in user's notifications for
the current room and shows the unread ones highlighted. Once the list has
been shown, everything in this room is marked as read, so the bell in the
header stops glowing. (The highlights stay on screen until you leave the
page, so you can still see what was new.) Notifications are created by the
database; this page only reads them and marks them read through an RPC.
Join-request notifications (room owners only) also get Approve / Deny
buttons, which call the approve_join_request / deny_join_request RPCs; the
database checks that the caller really owns the room. All text is inserted
with textContent so names and reasons are never interpreted as HTML.
*/
window.onload = async function () {
    const currentRoomId = localStorage.getItem("currentRoomId");
    const listDiv = document.getElementById("notification-list");

    const typeLabels = {
        payment_pending: "Payment Waiting for You",
        payment_declined: "Payment Declined",
        payment_confirmed: "Payment Confirmed",
        payment_received_recorded: "Payment Recorded",
        join_request: "Join Request",
    };

    function formatType(type) {
        if (typeLabels[type]) {
            return typeLabels[type];
        }
        return type
            .split("_")
            .map(function (word) {
                return word.charAt(0).toUpperCase() + word.slice(1);
            })
            .join(" ");
    }

    function showMessage(text) {
        listDiv.innerHTML = "";
        const p = document.createElement("p");
        p.textContent = text;
        listDiv.appendChild(p);
    }

    // authGuard.js defines refreshNotificationBadge once the session has
    // loaded; on a very fast page load it may not exist yet, so retry briefly.
    function refreshBadge(attempt) {
        const tries = attempt || 0;
        if (typeof window.refreshNotificationBadge === "function") {
            window.refreshNotificationBadge();
        } else if (tries < 10) {
            setTimeout(function () {
                refreshBadge(tries + 1);
            }, 300);
        }
    }

    function buildEntry(n, requestStatus) {
        const entry = document.createElement("div");
        entry.className = "notification-entry" + (n.is_read ? "" : " unread");

        const title = document.createElement("h3");
        title.textContent = formatType(n.type);
        if (!n.is_read) {
            const tag = document.createElement("span");
            tag.className = "new-tag";
            tag.textContent = "New";
            title.appendChild(tag);
        }
        entry.appendChild(title);

        const message = document.createElement("p");
        message.textContent = n.message;
        entry.appendChild(message);

        const when = document.createElement("p");
        const em = document.createElement("em");
        em.textContent = new Date(n.created_at).toLocaleString();
        when.appendChild(em);
        entry.appendChild(when);

        if (n.type === "join_request") {
            appendJoinRequestControls(entry, n, requestStatus);
        }

        return entry;
    }

    // Approve / Deny buttons while the request is pending; otherwise show how
    // it was resolved.
    function appendJoinRequestControls(entry, n, requestStatus) {
        if (requestStatus === "pending") {
            const actions = document.createElement("div");
            actions.className = "notification-actions";

            const approveBtn = document.createElement("button");
            approveBtn.className = "approve-btn";
            approveBtn.textContent = "Approve";

            const denyBtn = document.createElement("button");
            denyBtn.className = "deny-btn";
            denyBtn.textContent = "Deny";

            approveBtn.addEventListener("click", function () {
                decideRequest(n.related_id, "approve_join_request", [approveBtn, denyBtn]);
            });
            denyBtn.addEventListener("click", function () {
                decideRequest(n.related_id, "deny_join_request", [approveBtn, denyBtn]);
            });

            actions.appendChild(approveBtn);
            actions.appendChild(denyBtn);
            entry.appendChild(actions);
        } else if (requestStatus === "approved" || requestStatus === "denied") {
            const result = document.createElement("p");
            result.className = "request-status";
            result.textContent =
                requestStatus === "approved" ? "\u2705 Approved" : "\u274c Denied";
            entry.appendChild(result);
        }
    }

    async function decideRequest(requestId, rpcName, buttons) {
        for (let i = 0; i < buttons.length; i++) {
            buttons[i].disabled = true;
        }

        const { error } = await supabaseClient.rpc(rpcName, {
            request_id_input: requestId,
        });

        if (error) {
            console.error("Could not update join request:", error);
            window.alert(error.message || "Could not update this request.");
            // The request may have been handled already; reload to show the truth.
            await loadNotifications();
            return;
        }

        await loadNotifications();
    }

    async function markEverythingRead() {
        const { error } = await supabaseClient.rpc(
            "mark_all_notifications_read",
            { room_id_input: currentRoomId }
        );
        if (error) {
            console.error("Could not mark notifications read:", error);
            return;
        }
        refreshBadge();
    }

    async function loadNotifications() {
        const { data, error } = await supabaseClient
            .from("notifications")
            .select("id, type, message, is_read, created_at, related_id")
            .eq("room_id", currentRoomId)
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Could not load notifications:", error);
            showMessage("Something went wrong loading notifications. Try refreshing.");
            return;
        }

        if (!data || data.length === 0) {
            showMessage("No notifications yet.");
            return;
        }

        // Look up the current status of any join requests in the list.
        const requestIds = [];
        for (let i = 0; i < data.length; i++) {
            if (data[i].type === "join_request" && data[i].related_id) {
                requestIds.push(data[i].related_id);
            }
        }

        const requestStatuses = {};
        if (requestIds.length > 0) {
            const { data: requests, error: requestsError } = await supabaseClient
                .from("room_join_requests")
                .select("id, status")
                .in("id", requestIds);

            if (requestsError) {
                console.error("Could not load join requests:", requestsError);
            } else {
                for (let i = 0; i < requests.length; i++) {
                    requestStatuses[requests[i].id] = requests[i].status;
                }
            }
        }

        listDiv.innerHTML = "";
        let hasUnread = false;
        for (let i = 0; i < data.length; i++) {
            listDiv.appendChild(
                buildEntry(data[i], requestStatuses[data[i].related_id])
            );
            if (!data[i].is_read) {
                hasUnread = true;
            }
        }

        // They've now been shown, so clear the bell.
        if (hasUnread) {
            await markEverythingRead();
        }
    }

    loadNotifications();
};