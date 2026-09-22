/*
Name: Naman Agrawal
This is chores.js which handles logic and the backend math behind the Responsible Roommates app chores page.
*/
window.onload = function () {
    let expandChoreBtn = document.getElementById("expand-chore-btn");
    let choreForm = document.getElementById("chore-form");
    let roommates = JSON.parse(localStorage.getItem("roommates")) || [];
    let chores = JSON.parse(localStorage.getItem("chores")) || [];
    let history = JSON.parse(localStorage.getItem("history")) || [];
    let splitChores = document.getElementById("split-chores");
    let selectAllChores = document.getElementById("select-all");
    let splitChoreBtn = document.getElementById("split-chore-btn");
    splitChores.innerHTML = "";
    showChores(chores);

    for (let i = 0; i < roommates.length; i++) {
        splitChores.innerHTML +=
            '<label><input type="checkbox" class="chore-checkbox" value="' +
            roommates[i] +
            '" checked> ' +
            roommates[i] +
            "</label><br>";
    }

    expandChoreBtn.onclick = function () {
        if (choreForm.style.display === "none") {
            choreForm.style.display = "block";
            expandChoreBtn.innerHTML = "- Add Chore";
        } else {
            choreForm.style.display = "none";
            expandChoreBtn.innerHTML = "+ Add Chore";
        }
    };

    selectAllChores.onchange = function () {
        let boxes = document.getElementsByClassName("chore-checkbox");

        for (let i = 0; i < boxes.length; i++) {
            boxes[i].checked = selectAllChores.checked;
        }
    };

    splitChoreBtn.onclick = function () {
        let choreName = document.getElementById("task").value;
        let dueDate = document.getElementById("deadline").value;
        let selectedRoommates = [];
        let boxes = document.getElementsByClassName("chore-checkbox");

        for (let i = 0; i < boxes.length; i++) {
            if (boxes[i].checked) {
                selectedRoommates.push(boxes[i].value);
            }
        }

        if (choreName === "" || dueDate === "" || selectedRoommates.length === 0) {
            document.getElementById("chore-error").innerHTML =
                "<p>You need a chore name, due date, and at least one roommate.</p>";
            return;
        }

        document.getElementById("chore-error").innerHTML = "";

        chores.push({
            id: Date.now(),
            name: choreName,
            person: selectedRoommates,
            dueDate: dueDate,
        });

        localStorage.setItem("chores", JSON.stringify(chores));

        history.push({
            action: "Added chore",
            details: choreName + " - Assigned to " + selectedRoommates.join(", "),
            type: "chore",
            id: chores[chores.length - 1].id,
        });

        localStorage.setItem("history", JSON.stringify(history));

        showChores(chores);

        document.getElementById("task").value = "";
        document.getElementById("deadline").value = "";

        selectAllChores.checked = true;

        boxes = document.getElementsByClassName("chore-checkbox");

        for (let i = 0; i < boxes.length; i++) {
            boxes[i].checked = true;
        }

        choreForm.style.display = "none";
    };
};

function showChores(chores) {
    let choreList = document.getElementById("chore-list");

    if (chores.length === 0) {
        choreList.innerHTML = "<p>No chores added</p>";
        return;
    }

    choreList.innerHTML = "";

    for (let i = 0; i < chores.length; i++) {
        let chore = chores[i];

        choreList.innerHTML +=
            "<div class='chore-entry'>" +
            "<h3>" +
            chore.name +
            "</h3>" +
            "<p>Assigned to: " +
            chore.person.join(", ") +
            "</p>" +
            "<p>Due: " +
            chore.dueDate +
            "</p>" +
            "<button class='complete-chore-btn' data-id='" +
            chore.id +
            "'>Complete</button>" +
            "</div>";
    }

    let completeButtons = document.getElementsByClassName("complete-chore-btn");

    for (let i = 0; i < completeButtons.length; i++) {
        completeButtons[i].onclick = function () {
            let id = parseInt(this.getAttribute("data-id"));

            for (let j = 0; j < chores.length; j++) {
                if (chores[j].id === id) {
                    chores.splice(j, 1);
                    break;
                }
            }

            localStorage.setItem("chores", JSON.stringify(chores));

            showChores(chores);
        };
    }
    return chores;
}
