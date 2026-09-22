/*
Name: Naman Agrawal
This file runs on every protected page (main, chores, history, help).
It redirects to the login page if no one is signed in, and wires up the
shared "Log Out" button in the header.
*/

(async function () {
    const {
        data: { session },
    } = await supabaseClient.auth.getSession();

    if (!session) {
        window.location.href = "auth.html";
        return;
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
                await supabaseClient.auth.signOut();
                window.location.href = "auth.html";
            });
        }
    });
})();
