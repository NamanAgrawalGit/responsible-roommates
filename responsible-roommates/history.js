/*
Name: Naman Agrawal
This is history.js which handles logic and the backend math behind the Responsible Roommates app history page.
*/

window.onload = function () {
    let history = JSON.parse(localStorage.getItem("history")) || [];

    showHistory(history);

    let clearHistoryBtn = document.getElementById("clear-history-btn");

    clearHistoryBtn.onclick = function () {
        let confirmClear = confirm(
            "Are you sure you want to delete all history, roommates, expenses, and chores?"
        );

        if (!confirmClear) {
            return;
        }

        history = [];

        localStorage.removeItem("history");
        localStorage.removeItem("roommates");
        localStorage.removeItem("expenses");
        localStorage.removeItem("chores");

        showHistory(history);
    };
};

function showHistory(history) {
    let historyList = document.getElementById("history-list");

    if (history.length === 0) {
        historyList.innerHTML = "<p>No history yet</p>";
        return;
    }

    historyList.innerHTML = "";

    for (let i = 0; i < history.length; i++) {
        let entry = history[i];

        historyList.innerHTML +=
            "<div class='history-entry'>" +
            "<h3>" +
            entry.action +
            "</h3>" +
            "<p>" +
            entry.details +
            "</p>" +
            "<button class='delete-history-btn' data-index='" +
            i +
            "'>Delete</button>" +
            "</div>";
    }

    let deleteButtons = document.getElementsByClassName("delete-history-btn");

    for (let i = 0; i < deleteButtons.length; i++) {
        deleteButtons[i].onclick = function () {
            let index = parseInt(this.getAttribute("data-index"));

            let entry = history[index];

            if (entry.type === "roommate") {
                let roommates = JSON.parse(localStorage.getItem("roommates")) || [];

                let roommateIndex = roommates.indexOf(entry.details);

                if (roommateIndex !== -1) {
                    roommates.splice(roommateIndex, 1);
                }

                localStorage.setItem("roommates", JSON.stringify(roommates));
            }

            if (entry.type === "expense") {
                let expenses = JSON.parse(localStorage.getItem("expenses")) || [];

                for (let j = 0; j < expenses.length; j++) {
                    if (expenses[j].id === entry.id) {
                        expenses.splice(j, 1);
                        break;
                    }
                }

                localStorage.setItem("expenses", JSON.stringify(expenses));
            }

            if (entry.type === "chore") {
                let chores = JSON.parse(localStorage.getItem("chores")) || [];

                for (let j = 0; j < chores.length; j++) {
                    if (chores[j].id === entry.id) {
                        chores.splice(j, 1);
                        break;
                    }
                }

                localStorage.setItem("chores", JSON.stringify(chores));
            }

            history.splice(index, 1);

            localStorage.setItem("history", JSON.stringify(history));

            showHistory(history);
        };
    }
    return history;
}
