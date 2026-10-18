/*
Name: Naman Agrawal
This file runs on every protected page. It redirects to the login page if
no one is signed in, and — for pages that set `var REQUIRE_ROOM = true;`
before loading this script — also redirects to room-select.html if the
user hasn't chosen a room yet. It also wires up the shared "Log Out" and
"Switch Room" header links.
*/

(async function () {
    const {
        data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session) {
        window.location.href = "auth.html";
        return;
    }

    if (typeof REQUIRE_ROOM !== "undefined" && REQUIRE_ROOM) {
        const roomId = localStorage.getItem("currentRoomId");
        if (!roomId) {
            window.location.href = "room-select.html";
            return;
        }
    }

    // Keep this page in sync if the user logs out in another tab.
    supabaseClient.auth.onAuthStateChange(function (event, newSession) {
        if (!newSession) {
            window.location.href = "auth.html";
        }
    });

    // Lights up the bell in the header corner when the current room has
    // unread notifications, and clears it once they've been viewed. Fails
    // quietly: a bell problem should never break the page.
    async function updateNotificationBadge() {
        const link = document.getElementById("notifications-link");
        const roomId = localStorage.getItem("currentRoomId");
        if (!link || !roomId) {
            return;
        }

        const { count, error } = await supabaseClient
            .from("notifications")
            .select("id", { count: "exact", head: true })
            .eq("user_id", session.user.id)
            .eq("room_id", roomId)
            .eq("is_read", false);

        let badge = document.getElementById("notifications-badge");

        if (error || !count) {
            link.classList.remove("has-unread");
            link.setAttribute("aria-label", "Notifications");
            if (badge) {
                badge.remove();
            }
            return;
        }

        link.classList.add("has-unread");
        link.setAttribute(
            "aria-label",
            "Notifications (" + count + " unread)"
        );

        if (!badge) {
            badge = document.createElement("span");
            badge.id = "notifications-badge";
            badge.className = "bell-count";
            link.appendChild(badge);
        }
        badge.textContent = count > 99 ? "99+" : String(count);
    }
    window.refreshNotificationBadge = updateNotificationBadge;

    // Check again every 30 seconds and whenever the tab becomes visible, so
    // the bell lights up without a manual refresh.
    setInterval(updateNotificationBadge, 30000);
    document.addEventListener("visibilitychange", function () {
        if (!document.hidden) {
            updateNotificationBadge();
        }
    });

    function onPageReady() {
        updateNotificationBadge();

        const logoutBtn = document.getElementById("logout-btn");
        if (logoutBtn) {
            logoutBtn.addEventListener("click", async function (e) {
                e.preventDefault();
                localStorage.removeItem("currentRoomId");
                localStorage.removeItem("currentRoomName");
                await supabaseClient.auth.signOut();
                window.location.href = "auth.html";
            });
        }

        const switchRoomBtn = document.getElementById("switch-room-btn");
        if (switchRoomBtn) {
            switchRoomBtn.addEventListener("click", function (e) {
                e.preventDefault();
                window.location.href = "room-select.html";
            });
        }

        const roomLabel = document.getElementById("current-room-label");
        if (roomLabel) {
            const roomName = localStorage.getItem("currentRoomName");
            if (roomName) {
                roomLabel.innerHTML = "Room: " + roomName;
            }
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", onPageReady);
    } else {
        onPageReady();
    }
})();