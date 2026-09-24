/*
Name: Naman Agrawal
This is balances.js. It calculates the logged-in user's balances within
the current room, and shows the full expense list for the room (moved
here from the dashboard, which only shows the 3 most recent to stay
uncluttered).
*/
window.onload = async function () {
    const currentRoomId = localStorage.getItem("currentRoomId");
    const {
        data: { user },
    } = await supabaseClient.auth.getUser();

    const balanceSummaryDiv = document.getElementById("balance-summary");
    const owesListDiv = document.getElementById("you-owe-list");
    const owedListDiv = document.getElementById("owed-to-you-list");
    const allExpensesListDiv = document.getElementById("all-expenses-list");

    let namesById = {};

    async function loadMemberNames() {
        const { data, error } = await supabaseClient
            .from("room_members")
            .select("user_id, profiles(name)")
            .eq("room_id", currentRoomId)
            .eq("is_active", true);

        if (error || !data) {
            return;
        }

        namesById = {};
        for (let i = 0; i < data.length; i++) {
            namesById[data[i].user_id] = data[i].profiles ? data[i].profiles.name : "Unknown";
        }
    }

    async function loadBalances() {
        const { data: expenses, error } = await supabaseClient
            .from("expenses")
            .select("id, paid_by, expense_splits(user_id, amount_owed, payment_status)")
            .eq("room_id", currentRoomId);

        if (error) {
            balanceSummaryDiv.innerHTML = "<p>Something went wrong loading expenses.</p>";
            return;
        }

        // net[otherUserId] > 0 means they owe the current user.
        // net[otherUserId] < 0 means the current user owes them.
        const net = {};

        for (let i = 0; i < expenses.length; i++) {
            const expense = expenses[i];
            const payer = expense.paid_by;

            for (let j = 0; j < expense.expense_splits.length; j++) {
                const split = expense.expense_splits[j];

                if (split.payment_status === "paid" || split.user_id === payer) {
                    continue;
                }

                const amount = Number(split.amount_owed);

                if (split.user_id === user.id) {
                    net[payer] = (net[payer] || 0) - amount;
                } else if (payer === user.id) {
                    net[split.user_id] = (net[split.user_id] || 0) + amount;
                }
            }
        }

        const owesEntries = [];
        const owedEntries = [];

        for (const otherId in net) {
            const amount = net[otherId];
            const name = namesById[otherId] || "Unknown";
            if (amount > 0.004) {
                owedEntries.push({ name: name, amount: amount });
            } else if (amount < -0.004) {
                owesEntries.push({ name: name, amount: -amount });
            }
        }

        if (owesEntries.length === 0) {
            owesListDiv.innerHTML = "<p>You don't owe anyone right now.</p>";
        } else {
            owesListDiv.innerHTML = "";
            for (let i = 0; i < owesEntries.length; i++) {
                owesListDiv.innerHTML +=
                    "<div class='balance-row'><span>" +
                    owesEntries[i].name +
                    "</span><span>$" +
                    owesEntries[i].amount.toFixed(2) +
                    "</span></div>";
            }
        }

        if (owedEntries.length === 0) {
            owedListDiv.innerHTML = "<p>No one owes you anything right now.</p>";
        } else {
            owedListDiv.innerHTML = "";
            for (let i = 0; i < owedEntries.length; i++) {
                owedListDiv.innerHTML +=
                    "<div class='balance-row'><span>" +
                    owedEntries[i].name +
                    "</span><span>$" +
                    owedEntries[i].amount.toFixed(2) +
                    "</span></div>";
            }
        }

        const totalOwed = owesEntries.reduce(function (sum, e) {
            return sum + e.amount;
        }, 0);
        const totalOwedToYou = owedEntries.reduce(function (sum, e) {
            return sum + e.amount;
        }, 0);
        const netTotal = totalOwedToYou - totalOwed;

        balanceSummaryDiv.innerHTML =
            "<p>You owe a total of $" +
            totalOwed.toFixed(2) +
            "</p><p>You are owed a total of $" +
            totalOwedToYou.toFixed(2) +
            "</p><p><strong>Net: " +
            (netTotal >= 0 ? "+$" + netTotal.toFixed(2) : "-$" + Math.abs(netTotal).toFixed(2)) +
            "</strong></p>";
    }

    async function loadAllExpenses() {
        const { data, error } = await supabaseClient
            .from("expenses")
            .select("id, name, amount, paid_by, date, expense_splits(user_id, amount_owed, payment_status)")
            .eq("room_id", currentRoomId)
            .order("date", { ascending: false });

        if (error) {
            allExpensesListDiv.innerHTML = "<p>Something went wrong loading expenses.</p>";
            return;
        }

        if (!data || data.length === 0) {
            allExpensesListDiv.innerHTML = "<p>No expenses added</p>";
            return;
        }

        allExpensesListDiv.innerHTML = "";
        for (let i = 0; i < data.length; i++) {
            const expense = data[i];
            const payerName = namesById[expense.paid_by] || "Unknown";

            let splitsHtml = "";
            for (let j = 0; j < expense.expense_splits.length; j++) {
                const split = expense.expense_splits[j];
                const name = namesById[split.user_id] || "Unknown";
                splitsHtml +=
                    name +
                    ": $" +
                    Number(split.amount_owed).toFixed(2) +
                    (split.payment_status === "paid" ? " (paid)" : " (unpaid)") +
                    "<br>";
            }

            allExpensesListDiv.innerHTML +=
                "<div class='expense-entry'><h3>" +
                expense.name +
                " — $" +
                Number(expense.amount).toFixed(2) +
                " (" +
                expense.date +
                ")</h3>" +
                "<p>Paid by: " +
                payerName +
                "</p><p>" +
                splitsHtml +
                "</p></div>";
        }
    }

    await loadMemberNames();
    await loadBalances();
    await loadAllExpenses();
};
