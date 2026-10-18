/*
Name: Naman Agrawal
This is notifications.js. It loads the signed-in user's notifications for
the current room, highlights unread ones, and lets the user mark them as
read. Notifications are created by the database (for example when a
roommate declines a payment you recorded); this page only reads them and
marks them read through RPCs. All text is inserted with textContent so
names and reasons are never interpreted as HTML.
*/
window.onload = async function () {
    const currentRoomId = localStorage.getItem("currentRoomId");
    const listDiv = document.getElementById("notification-list");
    const markAllBtn = document.getElementById("mark-all-read-btn");

    const typeLabels = {
        payment_declined: "Payment Declined",
        payment_confirmed: "Payment Confirmed",
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

    function refreshBadge() {
        if (typeof window.refreshNotificationBadge === "function") {
            window.refreshNotificationBadge();
        }
    }

    async function markRead(id) {
        const { error } = await supabaseClient.rpc("mark_notification_read", {
            notification_id_input: id,
        });
        if (error) {
            console.error("Could not mark notification read:", error);
            return;
        }
        await loadNotifications();
        refreshBadge();
    }

    function buildEntry(n) {
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

        if (!n.is_read) {
            const btn = document.createElement("button");
            btn.className = "notification-action-btn";
            btn.textContent = "Mark as read";
            btn.addEventListener("click", function () {
                btn.disabled = true;
                markRead(n.id);
            });
            entry.appendChild(btn);
        }

        return entry;
    }

    async function loadNotifications() {
        const { data, error } = await supabaseClient
            .from("notifications")
            .select("id, type, message, is_read, created_at")
            .eq("room_id", currentRoomId)
            .order("created_at", { ascending: false });

        if (error) {
            console.error("Could not load notifications:", error);
            showMessage("Something went wrong loading notifications. Try refreshing.");
            markAllBtn.style.display = "none";
            return;
        }

        if (!data || data.length === 0) {
            showMessage("No notifications yet.");
            markAllBtn.style.display = "none";
            return;
        }

        const hasUnread = data.some(function (n) {
            return !n.is_read;
        });
        markAllBtn.style.display = hasUnread ? "" : "none";

        listDiv.innerHTML = "";
        for (let i = 0; i < data.length; i++) {
            listDiv.appendChild(buildEntry(data[i]));
        }
    }

    markAllBtn.addEventListener("click", async function () {
        markAllBtn.disabled = true;
        const { error } = await supabaseClient.rpc("mark_all_notifications_read", {
            room_id_input: currentRoomId,
        });
        markAllBtn.disabled = false;
        if (error) {
            console.error("Could not mark all read:", error);
            return;
        }
        await loadNotifications();
        refreshBadge();
    });

    loadNotifications();
};