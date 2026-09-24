/*
Name: Naman Agrawal
This is main.js. It loads the current room's members, expenses, and an
open-chores preview from Supabase, and handles adding new expenses.
Replaces the old localStorage-based version.
*/
window.onload = async function () {
    const currentRoomId = localStorage.getItem("currentRoomId");
    const {
        data: { user },
    } = await supabaseClient.auth.getUser();

    let members = []; // [{ id, name, role }]
    let membersById = {};

    const roommateList = document.getElementById("roommate-list");
    const roommateCount = document.getElementById("roommate-count");
    const inviteInfo = document.getElementById("invite-info");
    const splitCheckboxes = document.getElementById("split-checkboxes");
    const paidBySelect = document.getElementById("paid-by");
    const selectAllCheckboxes = document.getElementById("select-all");
    const splitExpenseExpand = document.getElementById("split-expense-expand");
    const splitExpenseForm = document.getElementById("split-expense-form");
    const splitCostBtn = document.getElementById("split-cost-btn");
    const expenseErrorDiv = document.getElementById("expense-error");
    const expenseListDiv = document.getElementById("expense-list");
    const balanceSummaryMiniDiv = document.getElementById("balance-summary-mini");
    const choreListDiv = document.getElementById("chore-list");

    // Expand/close the split-expense area. (Uses a plain flag instead of
    // reading style.display back, since CSS — not inline style — is what
    // hides the form initially.)
    let expenseFormOpen = false;
    splitExpenseExpand.addEventListener("click", function () {
        expenseFormOpen = !expenseFormOpen;
        splitExpenseForm.style.display = expenseFormOpen ? "block" : "none";
        splitExpenseExpand.innerHTML = expenseFormOpen ? " - Split an Expense" : "+ Split an Expense";
    });

    selectAllCheckboxes.addEventListener("change", function () {
        const boxes = document.getElementsByClassName("roommate-checkbox");
        for (let i = 0; i < boxes.length; i++) {
            boxes[i].checked = selectAllCheckboxes.checked;
        }
    });

    async function loadMembers() {
        const { data, error } = await supabaseClient
            .from("room_members")
            .select("user_id, role, profiles(name)")
            .eq("room_id", currentRoomId)
            .eq("is_active", true);

        if (error || !data) {
            roommateList.innerHTML = "<p>Could not load roommates.</p>";
            return;
        }

        members = data.map(function (m) {
            return {
                id: m.user_id,
                name: m.profiles ? m.profiles.name : "Unknown",
                role: m.role,
            };
        });

        membersById = {};
        for (let i = 0; i < members.length; i++) {
            membersById[members[i].id] = members[i].name;
        }

        roommateCount.innerHTML =
            '<img src="images/ppl.png" alt="">' + "<h3>" + members.length + " Roommates</h3>";

        roommateList.innerHTML = "";
        for (let i = 0; i < members.length; i++) {
            roommateList.innerHTML +=
                "<p>" + members[i].name + (members[i].role === "owner" ? " (owner)" : "") + "</p>";
        }

        splitCheckboxes.innerHTML = "";
        for (let i = 0; i < members.length; i++) {
            splitCheckboxes.innerHTML +=
                '<label><input type="checkbox" class="roommate-checkbox" value="' +
                members[i].id +
                '" checked> ' +
                members[i].name +
                "</label><br>";
        }

        paidBySelect.innerHTML = "";
        for (let i = 0; i < members.length; i++) {
            const selectedAttr = members[i].id === user.id ? "selected" : "";
            paidBySelect.innerHTML +=
                "<option value='" + members[i].id + "' " + selectedAttr + ">" + members[i].name + "</option>";
        }

        const myMembership = members.find(function (m) {
            return m.id === user.id;
        });

        if (myMembership && myMembership.role === "owner") {
            const { data: roomData } = await supabaseClient
                .from("rooms")
                .select("invite_code")
                .eq("id", currentRoomId)
                .single();
            if (roomData) {
                inviteInfo.innerHTML =
                    "<p>Invite code (share with roommates): <strong>" + roomData.invite_code + "</strong></p>";
            }
        } else {
            inviteInfo.innerHTML = "";
        }
    }

    async function loadBalanceSummary() {
        const { data, error } = await supabaseClient
            .from("expenses")
            .select("paid_by, expense_splits(user_id, amount_owed, payment_status)")
            .eq("room_id", currentRoomId);

        if (error) {
            balanceSummaryMiniDiv.innerHTML = "<p>Could not load balance.</p>";
            return;
        }

        let totalOwed = 0;
        let totalOwedToYou = 0;

        for (let i = 0; i < data.length; i++) {
            const expense = data[i];
            for (let j = 0; j < expense.expense_splits.length; j++) {
                const split = expense.expense_splits[j];

                if (split.payment_status === "paid" || split.user_id === expense.paid_by) {
                    continue;
                }

                const amount = Number(split.amount_owed);

                if (split.user_id === user.id) {
                    totalOwed += amount;
                } else if (expense.paid_by === user.id) {
                    totalOwedToYou += amount;
                }
            }
        }

        balanceSummaryMiniDiv.innerHTML =
            "<div class='mini-balance-row'><span>You owe</span><span>$" +
            totalOwed.toFixed(2) +
            "</span></div>" +
            "<div class='mini-balance-row'><span>Owed to you</span><span>$" +
            totalOwedToYou.toFixed(2) +
            "</span></div>" +
            "<a href='balances.html' class='balance-link'>View full balances &rarr;</a>";
    }

    async function loadExpenses() {
        const { data, error } = await supabaseClient
            .from("expenses")
            .select("id, name, amount, paid_by, date, expense_splits(user_id, amount_owed, payment_status)")
            .eq("room_id", currentRoomId)
            .order("date", { ascending: false });

        if (error) {
            expenseListDiv.innerHTML = "<p>Something went wrong loading expenses. Try refreshing.</p>";
            return;
        }

        if (!data || data.length === 0) {
            expenseListDiv.innerHTML = "<p>No expenses added</p>";
            return;
        }

        expenseListDiv.innerHTML = "";
        for (let i = 0; i < data.length; i++) {
            const expense = data[i];
            const payerName = membersById[expense.paid_by] || "Unknown";

            let splitsHtml = "";
            for (let j = 0; j < expense.expense_splits.length; j++) {
                const split = expense.expense_splits[j];
                const name = membersById[split.user_id] || "Unknown";
                splitsHtml +=
                    name +
                    ": $" +
                    Number(split.amount_owed).toFixed(2) +
                    (split.payment_status === "paid" ? " (paid)" : " (unpaid)") +
                    "<br>";
            }

            expenseListDiv.innerHTML +=
                "<div class='expense-entry'><h3>" +
                expense.name +
                " — $" +
                Number(expense.amount).toFixed(2) +
                "</h3>" +
                "<p>Paid by: " +
                payerName +
                "</p><p>" +
                splitsHtml +
                "</p></div>";
        }
    }

    async function loadChoresPreview() {
        const { data, error } = await supabaseClient
            .from("chores")
            .select("id, name, assigned_to, due_date")
            .eq("room_id", currentRoomId)
            .eq("status", "open")
            .order("due_date", { ascending: true });

        if (error || !data || data.length === 0) {
            choreListDiv.innerHTML = "<p>No chores added</p>";
            return;
        }

        choreListDiv.innerHTML = "";
        for (let i = 0; i < data.length; i++) {
            const chore = data[i];
            choreListDiv.innerHTML +=
                "<div class='chore-entry'><h3>" +
                chore.name +
                "</h3><p>Assigned to: " +
                (membersById[chore.assigned_to] || "Unassigned") +
                "</p><p>Due: " +
                (chore.due_date || "No due date") +
                "</p></div>";
        }
    }

    splitCostBtn.addEventListener("click", async function () {
        const item = document.getElementById("item").value.trim();
        const amount = parseFloat(document.getElementById("amount").value);
        const paidBy = paidBySelect.value;
        const boxes = document.getElementsByClassName("roommate-checkbox");
        const selected = [];
        for (let i = 0; i < boxes.length; i++) {
            if (boxes[i].checked) {
                selected.push(boxes[i].value);
            }
        }

        expenseErrorDiv.innerHTML = "";

        if (item === "" || isNaN(amount) || amount <= 0 || selected.length === 0 || !paidBy) {
            expenseErrorDiv.innerHTML =
                "<p>You need an expense item, who paid, roommates to split with, and a valid amount.</p>";
            return;
        }

        splitCostBtn.disabled = true;

        const { data: expenseData, error: expenseInsertError } = await supabaseClient
            .from("expenses")
            .insert({
                room_id: currentRoomId,
                name: item,
                amount: amount,
                paid_by: paidBy,
                split_method: "equal",
                created_by: user.id,
            })
            .select()
            .single();

        if (expenseInsertError) {
            splitCostBtn.disabled = false;
            expenseErrorDiv.innerHTML = "<p>" + expenseInsertError.message + "</p>";
            return;
        }

        const perPerson = amount / selected.length;
        const splitRows = selected.map(function (memberId) {
            return {
                expense_id: expenseData.id,
                user_id: memberId,
                amount_owed: perPerson,
                payment_status: memberId === paidBy ? "paid" : "unpaid",
            };
        });

        const { error: splitsError } = await supabaseClient.from("expense_splits").insert(splitRows);

        await supabaseClient.from("history").insert({
            room_id: currentRoomId,
            actor_id: user.id,
            action: "expense_added",
            details: item + " - $" + amount.toFixed(2),
            related_type: "expense",
            related_id: expenseData.id,
        });

        splitCostBtn.disabled = false;

        if (splitsError) {
            expenseErrorDiv.innerHTML = "<p>" + splitsError.message + "</p>";
            return;
        }

        document.getElementById("item").value = "";
        document.getElementById("amount").value = "";
        splitExpenseForm.style.display = "none";
        expenseFormOpen = false;
        splitExpenseExpand.innerHTML = "+ Split an Expense";

        loadExpenses();
        loadBalanceSummary();
    });

    await loadMembers();
    await loadBalanceSummary();
    await loadExpenses();
    await loadChoresPreview();
};
