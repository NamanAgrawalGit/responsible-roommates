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

    document.addEventListener("DOMContentLoaded", function () {
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
    });
})();
