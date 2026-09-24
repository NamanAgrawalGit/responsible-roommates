/*
Name: Naman Agrawal
This is balances.js. It calculates the logged-in user's balances within
the current room — what they owe other roommates, and what other
roommates owe them — based on unpaid expense splits.
*/
window.onload = async function () {
    const currentRoomId = localStorage.getItem("currentRoomId");
    const {
        data: { user },
    } = await supabaseClient.auth.getUser();

    const balanceSummaryDiv = document.getElementById("balance-summary");
    const owesListDiv = document.getElementById("you-owe-list");
    const owedListDiv = document.getElementById("owed-to-you-list");

    async function loadBalances() {
        const { data: memberRows, error: memberError } = await supabaseClient
            .from("room_members")
            .select("user_id, profiles(name)")
            .eq("room_id", currentRoomId)
            .eq("is_active", true);

        if (memberError || !memberRows) {
            balanceSummaryDiv.innerHTML = "<p>Something went wrong loading roommates.</p>";
            return;
        }

        const namesById = {};
        for (let i = 0; i < memberRows.length; i++) {
            namesById[memberRows[i].user_id] = memberRows[i].profiles
                ? memberRows[i].profiles.name
                : "Unknown";
        }

        const { data: expenses, error: expenseError } = await supabaseClient
            .from("expenses")
            .select("id, paid_by, expense_splits(user_id, amount_owed, payment_status)")
            .eq("room_id", currentRoomId);

        if (expenseError) {
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
                // Expenses that don't involve the current user at all are
                // skipped — this page shows "my" balances, not the whole
                // room's ledger.
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

    loadBalances();
};
