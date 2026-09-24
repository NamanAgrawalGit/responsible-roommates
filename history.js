/*
Name: Naman Agrawal
This is history.js. It loads the current room's activity history from
Supabase — expenses added, chores added/completed, roommates joining, etc.
Replaces the old localStorage-based version. History is read-only: unlike
the old local version, entries can't be deleted, since this is now a
shared, permanent record for the whole room rather than a personal log.
*/
window.onload = async function () {
    const currentRoomId = localStorage.getItem("currentRoomId");
    const historyList = document.getElementById("history-list");

    const actionLabels = {
        expense_added: "Expense Added",
        chore_added: "Chore Added",
        chore_completed: "Chore Completed",
        roommate_joined: "Roommate Joined",
    };

    function formatAction(action) {
        if (actionLabels[action]) {
            return actionLabels[action];
        }
        return action
            .split("_")
            .map(function (word) {
                return word.charAt(0).toUpperCase() + word.slice(1);
            })
            .join(" ");
    }

    async function loadHistory() {
        const { data, error } = await supabaseClient
            .from("history")
            .select("id, action, details, created_at, profiles(name)")
            .eq("room_id", currentRoomId)
            .order("created_at", { ascending: false });

        if (error) {
            historyList.innerHTML = "<p>Something went wrong loading history. Try refreshing.</p>";
            return;
        }

        if (!data || data.length === 0) {
            historyList.innerHTML = "<p>No history yet</p>";
            return;
        }

        historyList.innerHTML = "";
        for (let i = 0; i < data.length; i++) {
            const entry = data[i];
            const actorName = entry.profiles ? entry.profiles.name : "Someone";
            const when = new Date(entry.created_at).toLocaleString();

            historyList.innerHTML +=
                "<div class='history-entry'>" +
                "<h3>" +
                formatAction(entry.action) +
                "</h3>" +
                "<p>" +
                (entry.details || "") +
                "</p>" +
                "<p><em>" +
                actorName +
                " — " +
                when +
                "</em></p>" +
                "</div>";
        }
    }

    loadHistory();
};
