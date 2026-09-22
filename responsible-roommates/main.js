/*
Name: Naman Agrawal
This is main.js which handles logic and the backend math behind the Responsible Roommates app main page.
*/
window.onload = function () {
    let roommates = JSON.parse(localStorage.getItem("roommates")) || [];
    let roommatename;
    let addRoommateBtn = document.getElementById("add-roommate-btn");
    let roommateList = document.getElementById("roommate-list");
    let roommateNameInput = document.getElementById("roommates-name");
    let roommateError = document.getElementById("roommate-error");
    let selectAllCheckboxes = document.getElementById("select-all");
    let splitCheckboxes = document.getElementById("split-checkboxes");
    let expenses = JSON.parse(localStorage.getItem("expenses")) || [];
    let chores = JSON.parse(localStorage.getItem("chores")) || [];
    let history = JSON.parse(localStorage.getItem("history")) || [];
    let splitExpenseExpand = document.getElementById("split-expense-expand");
    let splitExpenseForm = document.getElementById("split-expense-form");
    let splitCostBtn = document.getElementById("split-cost-btn");

    showRoommates(roommates, roommateList);
    showExpenseCheckboxes(splitCheckboxes, roommates);
    showExpenses(expenses);
    showChores(chores);

    //expand or close the split expense area
    splitExpenseExpand.addEventListener("click", function () {
        if (splitExpenseForm.style.display === "none") {
            splitExpenseForm.style.display = "block";
            splitExpenseExpand.innerHTML = " - Split an Expense";
        } else {
            splitExpenseForm.style.display = "none";
            splitExpenseExpand.innerHTML = "+ Split an Expense";
        }
    });

    roommateNameInput.addEventListener("input", function () {
        roommateError.innerHTML = "";
    });

    addRoommateBtn.addEventListener("click", function () {
        roommatename = roommateNameInput.value.toLowerCase();
        if (roommatename === "") {
            return;
        }
        if (roommates.includes(roommatename)) {
            roommateError.innerHTML = "<p>" + roommatename + " is already a roommate.</p>";
            return;
        }
        roommateError.innerHTML = "";
        roommates.push(roommatename);
        localStorage.setItem("roommates", JSON.stringify(roommates));

        history.push({
            action: "Added roommate",
            details: roommatename,
            type: "roommate",
        });
        localStorage.setItem("history", JSON.stringify(history));

        showRoommates(roommates, roommateList);
        showExpenseCheckboxes(splitCheckboxes, roommates);
        roommateNameInput.value = "";
    });

    splitCostBtn.addEventListener("click", function () {
        let item = document.getElementById("item").value;
        let amount = parseFloat(document.getElementById("amount").value);
        let selectedRoommates = [];
        let boxes = document.getElementsByClassName("roommate-checkbox");
        for (let i = 0; i < boxes.length; i++) {
            if (boxes[i].checked) {
                selectedRoommates.push(boxes[i].value);
            }
        }
        if (selectedRoommates.length === 0 || isNaN(amount) || amount <= 0 || item === "") {
            document.getElementById("expense-error").innerHTML =
                "<p>You need an expense item, roommates, and a valid expense amount.</p>";
            return;
        }
        document.getElementById("expense-error").innerHTML = "";
        let perPerson = (amount / selectedRoommates.length).toFixed(2);
        expenses.push({
            id: Date.now(),
            item: item,
            amount: amount,
            perPerson: perPerson,
            people: selectedRoommates,
        });
        localStorage.setItem("expenses", JSON.stringify(expenses));
        history.push({
            action: "Added expense",
            details: item + " - $" + amount.toFixed(2),
            type: "expense",
            id: expenses[expenses.length - 1].id,
        });
        localStorage.setItem("history", JSON.stringify(history));
        showExpenses(expenses);
        document.getElementById("item").value = "";
        document.getElementById("amount").value = "";

        splitExpenseForm.style.display = "none";
        splitExpenseExpand.innerHTML = "+ Split an Expense";
    });

    selectAllCheckboxes.addEventListener("change", function () {
        let boxes = document.getElementsByClassName("roommate-checkbox");
        for (let i = 0; i < boxes.length; i++) {
            boxes[i].checked = selectAllCheckboxes.checked;
        }
    });
};

function showRoommates(roommates, roommateList) {
    document.getElementById("roommate-count").innerHTML =
        '<img src="images/ppl.png" alt="">' + "<h3>" + roommates.length + " Roommates</h3>";

    roommateList.innerHTML = "";
    for (let i = 0; i < roommates.length; i++) {
        roommateList.innerHTML += "<p>" + roommates[i] + "</p>";
    }
    return roommates;
}

//creating a checkbox for each of the roommates and is checked by default
function showExpenseCheckboxes(splitCheckboxes, roommates) {
    splitCheckboxes.innerHTML = "";
    for (let i = 0; i < roommates.length; i++) {
        splitCheckboxes.innerHTML +=
            '<label><input type="checkbox" class="roommate-checkbox" value="' +
            roommates[i] +
            '" checked> ' +
            roommates[i] +
            "</label><br>";
    }
    return splitCheckboxes;
}

function showExpenses(expenses) {
    let expenseList = document.getElementById("expense-list");
    if (expenses.length === 0) {
        expenseList.innerHTML = "<p>No expenses added</p>";
        return;
    }
    expenseList.innerHTML = "";
    for (let i = 0; i < expenses.length; i++) {
        let expense = expenses[i];
        expenseList.innerHTML +=
            "<div class='expense-entry'><h3>" +
            expense.item +
            ": $" +
            expense.perPerson +
            " each</h3>" +
            "<p>Total: $" +
            expense.amount.toFixed(2) +
            " - Split between: " +
            expense.people.join(", ") +
            "</p></div>";
    }
    return expenses;
}

//shows the chores
//currently only shows no chores added for project 2
//eventually when other pages will be added this will show more
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
            chore.person +
            "</p>" +
            "<p>Due: " +
            chore.dueDate +
            "</p>" +
            "</div>";
    }
}
