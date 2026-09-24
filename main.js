/*
Name: Naman Agrawal
This is main.js. It loads the current room's members, a balance summary,
the 3 most recent expenses, and an open-chores preview from Supabase, and
handles adding new expenses (equal or custom-dollar split).
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
    const amountInput = document.getElementById("amount");
    const splitEqualRadio = document.getElementById("split-equal");
    const splitCustomRadio = document.getElementById("split-custom");
    const customSplitSection = document.getElementById("custom-split-section");
    const customSplitInputs = document.getElementById("custom-split-inputs");
    const customSplitRemaining = document.getElementById("custom-split-remaining");

    const RECENT_EXPENSE_LIMIT = 3;

    // Expand/close the split-expense area. (Uses a plain flag instead of
    // reading style.display back, since CSS — not inline style — is what
    // hides the form initially.)
    let expenseFormOpen = false;
    splitExpenseExpand.addEventListener("click", function () {
        expenseFormOpen = !expenseFormOpen;
        splitExpenseForm.style.display = expenseFormOpen ? "block" : "none";
        splitExpenseExpand.innerHTML = expenseFormOpen ? " - Split an Expense" : "+ Split an Expense";
    });

    function getSelectedMemberIds() {
        const boxes = document.getElementsByClassName("roommate-checkbox");
        const selected = [];
        for (let i = 0; i < boxes.length; i++) {
            if (boxes[i].checked) {
                selected.push(boxes[i].value);
            }
        }
        return selected;
    }

    function isCustomMode() {
        return splitCustomRadio.checked;
    }

    // Rebuilds the per-person dollar-amount inputs whenever the split
    // method is "custom" and either the participant list or the total
    // amount changes.
    function renderCustomSplitInputs() {
        if (!isCustomMode()) {
            customSplitSection.style.display = "none";
            return;
        }

        customSplitSection.style.display = "block";
        const selectedIds = getSelectedMemberIds();

        // Preserve any amounts already typed in, keyed by member id.
        const existingValues = {};
        const existingInputs = document.getElementsByClassName("custom-amount-input");
        for (let i = 0; i < existingInputs.length; i++) {
            existingValues[existingInputs[i].getAttribute("data-member-id")] = existingInputs[i].value;
        }

        customSplitInputs.innerHTML = "";
        for (let i = 0; i < selectedIds.length; i++) {
            const memberId = selectedIds[i];
            const name = membersById[memberId] || "Unknown";
            const prevValue = existingValues[memberId] || "";
            customSplitInputs.innerHTML +=
                "<div class='custom-split-row'><label>" +
                name +
                "</label><input type='number' step='0.01' min='0' class='custom-amount-input' " +
                "data-member-id='" +
                memberId +
                "' value='" +
                prevValue +
                "' placeholder='$0.00'></div>";
        }

        const newInputs = document.getElementsByClassName("custom-amount-input");
        for (let i = 0; i < newInputs.length; i++) {
            newInputs[i].addEventListener("input", updateRemainingDisplay);
        }

        updateRemainingDisplay();
    }

    function updateRemainingDisplay() {
        const total = parseFloat(amountInput.value) || 0;
        const inputs = document.getElementsByClassName("custom-amount-input");
        let sum = 0;
        for (let i = 0; i < inputs.length; i++) {
            sum += parseFloat(inputs[i].value) || 0;
        }
        const remaining = total - sum;
        customSplitRemaining.innerHTML =
            "Remaining to assign: $" + remaining.toFixed(2) + " (of $" + total.toFixed(2) + " total)";
    }

    splitEqualRadio.addEventListener("change", renderCustomSplitInputs);
    splitCustomRadio.addEventListener("change", renderCustomSplitInputs);
    amountInput.addEventListener("input", updateRemainingDisplay);

    selectAllCheckboxes.addEventListener("change", function () {
        const boxes = document.getElementsByClassName("roommate-checkbox");
        for (let i = 0; i < boxes.length; i++) {
            boxes[i].checked = selectAllCheckboxes.checked;
        }
        renderCustomSplitInputs();
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
        const checkboxes = document.getElementsByClassName("roommate-checkbox");
        for (let i = 0; i < checkboxes.length; i++) {
            checkboxes[i].addEventListener("change", renderCustomSplitInputs);
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

    // Only the most recent few expenses show here — the dashboard is meant
    // to be a quick glance, not a full ledger. Everything (all expenses,
    // in full) lives on the Balances page.
    async function loadExpenses() {
        const { data, error } = await supabaseClient
            .from("expenses")
            .select("id, name, amount, paid_by, date, expense_splits(user_id, amount_owed, payment_status)")
            .eq("room_id", currentRoomId)
            .order("date", { ascending: false })
            .limit(RECENT_EXPENSE_LIMIT);

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

        expenseListDiv.innerHTML +=
            "<a href='balances.html' class='balance-link'>View all expenses &rarr;</a>";
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
        const amount = parseFloat(amountInput.value);
        const paidBy = paidBySelect.value;
        const selected = getSelectedMemberIds();

        expenseErrorDiv.innerHTML = "";

        if (item === "" || isNaN(amount) || amount <= 0 || selected.length === 0 || !paidBy) {
            expenseErrorDiv.innerHTML =
                "<p>You need an expense item, who paid, roommates to split with, and a valid amount.</p>";
            return;
        }

        let splitAmounts = {}; // memberId -> amount owed
        const splitMethod = isCustomMode() ? "custom" : "equal";

        if (splitMethod === "equal") {
            const perPerson = amount / selected.length;
            for (let i = 0; i < selected.length; i++) {
                splitAmounts[selected[i]] = perPerson;
            }
        } else {
            const inputs = document.getElementsByClassName("custom-amount-input");
            let sum = 0;
            for (let i = 0; i < inputs.length; i++) {
                const memberId = inputs[i].getAttribute("data-member-id");
                const value = parseFloat(inputs[i].value);
                if (isNaN(value) || value < 0) {
                    expenseErrorDiv.innerHTML = "<p>Enter a valid amount for every selected roommate.</p>";
                    return;
                }
                splitAmounts[memberId] = value;
                sum += value;
            }

            if (Math.abs(sum - amount) > 0.01) {
                expenseErrorDiv.innerHTML =
                    "<p>Custom amounts must add up to $" +
                    amount.toFixed(2) +
                    " (currently $" +
                    sum.toFixed(2) +
                    ").</p>";
                return;
            }
        }

        splitCostBtn.disabled = true;

        const { data: expenseData, error: expenseInsertError } = await supabaseClient
            .from("expenses")
            .insert({
                room_id: currentRoomId,
                name: item,
                amount: amount,
                paid_by: paidBy,
                split_method: splitMethod,
                created_by: user.id,
            })
            .select()
            .single();

        if (expenseInsertError) {
            splitCostBtn.disabled = false;
            expenseErrorDiv.innerHTML = "<p>" + expenseInsertError.message + "</p>";
            return;
        }

        const splitRows = selected.map(function (memberId) {
            return {
                expense_id: expenseData.id,
                user_id: memberId,
                amount_owed: splitAmounts[memberId],
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
        amountInput.value = "";
        splitEqualRadio.checked = true;
        customSplitSection.style.display = "none";
        customSplitInputs.innerHTML = "";
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
