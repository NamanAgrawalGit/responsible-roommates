/*
Name: Naman Agrawal
This is balances.js. It calculates the logged-in user's balances within
the current room, shows the full expense list for the room, and handles
recording, confirming, and declining payments between roommates.
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
    const awaitingConfirmationListDiv = document.getElementById("awaiting-confirmation-list");
    const sentPaymentsListDiv = document.getElementById("sent-payments-list");

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

    // Builds one "You Owe" / "Owed to You" row, with an inline "I Paid
    // This" / "They Paid Me" form attached. direction is "owe" (current
    // user is the one who would be paying) or "owed" (current user would
    // be receiving and self-confirming on the spot).
    function buildBalanceEntryHtml(entry, direction) {
        const buttonLabel = direction === "owe" ? "I Paid This" : "They Paid Me";
        return (
            "<div class='balance-row-wrapper'>" +
            "<div class='balance-row'><span>" +
            entry.name +
            "</span><span>$" +
            entry.amount.toFixed(2) +
            "</span></div>" +
            "<button class='mark-paid-btn' data-id='" +
            entry.id +
            "'>" +
            buttonLabel +
            "</button>" +
            "<div class='mark-paid-form' id='pay-form-" +
            entry.id +
            "'>" +
            "<label>Amount</label>" +
            "<input class='mark-paid-amount-input' data-member-id='" +
            entry.id +
            "' value='" +
            entry.amount.toFixed(2) +
            "'>" +
            "<label>Note (optional)</label>" +
            "<input type='text' class='mark-paid-note-input' data-member-id='" +
            entry.id +
            "' placeholder='e.g. Venmo'>" +
            "<button class='submit-mark-paid-btn' data-id='" +
            entry.id +
            "' data-name='" +
            entry.name +
            "' data-direction='" +
            direction +
            "'>Submit</button>" +
            "<div class='mark-paid-error' id='pay-error-" +
            entry.id +
            "'></div>" +
            "</div>" +
            "</div>"
        );
    }

    function wireMarkPaidButtons() {
        const toggleButtons = document.getElementsByClassName("mark-paid-btn");
        for (let i = 0; i < toggleButtons.length; i++) {
            toggleButtons[i].addEventListener("click", function () {
                const id = this.getAttribute("data-id");
                const form = document.getElementById("pay-form-" + id);
                form.classList.toggle("open");

                if (!form.getAttribute("data-currency-attached")) {
                    const amountInput = form.querySelector(".mark-paid-amount-input");
                    attachCurrencyInput(amountInput);
                    amountInput.value = "$" + amountInput.value;
                    form.setAttribute("data-currency-attached", "true");
                }
            });
        }

        const submitButtons = document.getElementsByClassName("submit-mark-paid-btn");
        for (let i = 0; i < submitButtons.length; i++) {
            submitButtons[i].addEventListener("click", async function () {
                const otherId = this.getAttribute("data-id");
                const otherName = this.getAttribute("data-name");
                const direction = this.getAttribute("data-direction");
                await submitMarkPaid(otherId, otherName, direction);
            });
        }
    }

    async function submitMarkPaid(otherId, otherName, direction) {
        const errorDiv = document.getElementById("pay-error-" + otherId);
        const amountInput = document.querySelector(".mark-paid-amount-input[data-member-id='" + otherId + "']");
        const noteInput = document.querySelector(".mark-paid-note-input[data-member-id='" + otherId + "']");
        errorDiv.innerHTML = "";

        const amount = getCurrencyValue(amountInput);
        if (isNaN(amount) || amount <= 0) {
            errorDiv.innerHTML = "Enter a valid amount.";
            return;
        }

        const note = noteInput.value.trim();
        const payerId = direction === "owe" ? user.id : otherId;
        const recipientId = direction === "owe" ? otherId : user.id;
        const status = direction === "owe" ? "pending" : "confirmed";

        const { error } = await supabaseClient.from("payments").insert({
            room_id: currentRoomId,
            payer_id: payerId,
            recipient_id: recipientId,
            amount: amount,
            status: status,
            note: note === "" ? null : note,
        });

        if (error) {
            errorDiv.innerHTML = error.message;
            return;
        }

        await supabaseClient.from("history").insert({
            room_id: currentRoomId,
            actor_id: user.id,
            action: direction === "owe" ? "payment_marked_paid" : "payment_confirmed",
            details:
                direction === "owe"
                    ? "Marked $" + amount.toFixed(2) + " as paid to " + otherName
                    : "Recorded $" + amount.toFixed(2) + " received from " + otherName,
            related_type: "payment",
        });

        await loadBalances();
        await loadPendingPayments();
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

        // Confirmed payments settle debt without touching expense_splits,
        // so they have to be folded in here too, on top of the raw
        // unpaid-split totals above.
        const { data: payments } = await supabaseClient
            .from("payments")
            .select("payer_id, recipient_id, amount")
            .eq("room_id", currentRoomId)
            .eq("status", "confirmed");

        if (payments) {
            for (let i = 0; i < payments.length; i++) {
                const payment = payments[i];
                const amount = Number(payment.amount);
                if (payment.payer_id === user.id) {
                    net[payment.recipient_id] = (net[payment.recipient_id] || 0) + amount;
                } else if (payment.recipient_id === user.id) {
                    net[payment.payer_id] = (net[payment.payer_id] || 0) - amount;
                }
            }
        }

        const owesEntries = [];
        const owedEntries = [];

        for (const otherId in net) {
            const amount = net[otherId];
            const name = namesById[otherId] || "Unknown";
            if (amount > 0.004) {
                owedEntries.push({ name: name, amount: amount, id: otherId });
            } else if (amount < -0.004) {
                owesEntries.push({ name: name, amount: -amount, id: otherId });
            }
        }

        if (owesEntries.length === 0) {
            owesListDiv.innerHTML = "<p>You don't owe anyone right now.</p>";
        } else {
            owesListDiv.innerHTML = "";
            for (let i = 0; i < owesEntries.length; i++) {
                owesListDiv.innerHTML += buildBalanceEntryHtml(owesEntries[i], "owe");
            }
        }

        if (owedEntries.length === 0) {
            owedListDiv.innerHTML = "<p>No one owes you anything right now.</p>";
        } else {
            owedListDiv.innerHTML = "";
            for (let i = 0; i < owedEntries.length; i++) {
                owedListDiv.innerHTML += buildBalanceEntryHtml(owedEntries[i], "owed");
            }
        }

        wireMarkPaidButtons();

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

    async function loadPendingPayments() {
        const { data: awaiting, error: awaitingError } = await supabaseClient
            .from("payments")
            .select("id, payer_id, amount, note")
            .eq("room_id", currentRoomId)
            .eq("recipient_id", user.id)
            .eq("status", "pending");

        if (awaitingError || !awaiting || awaiting.length === 0) {
            awaitingConfirmationListDiv.innerHTML = "<p>Nothing waiting on you right now.</p>";
        } else {
            awaitingConfirmationListDiv.innerHTML = "";
            for (let i = 0; i < awaiting.length; i++) {
                const p = awaiting[i];
                const payerName = namesById[p.payer_id] || "Unknown";
                awaitingConfirmationListDiv.innerHTML +=
                    "<div class='pending-payment-entry'>" +
                    "<p>" +
                    payerName +
                    " says they paid you $" +
                    Number(p.amount).toFixed(2) +
                    (p.note ? " — \"" + p.note + "\"" : "") +
                    "</p>" +
                    "<button class='confirm-payment-btn' data-id='" +
                    p.id +
                    "' data-payer='" +
                    payerName +
                    "' data-amount='" +
                    p.amount +
                    "'>Confirm</button>" +
                    "<button class='decline-payment-btn' data-id='" +
                    p.id +
                    "'>Decline</button>" +
                    "<div class='decline-form' id='decline-form-" +
                    p.id +
                    "'>" +
                    "<label>Reason (optional)</label>" +
                    "<input type='text' class='decline-reason-input' data-id='" +
                    p.id +
                    "' placeholder='e.g. I never received this'>" +
                    "<button class='submit-decline-btn' data-id='" +
                    p.id +
                    "'>Submit Decline</button>" +
                    "</div>" +
                    "</div>";
            }

            const confirmButtons = document.getElementsByClassName("confirm-payment-btn");
            for (let i = 0; i < confirmButtons.length; i++) {
                confirmButtons[i].addEventListener("click", async function () {
                    const id = this.getAttribute("data-id");
                    const payerName = this.getAttribute("data-payer");
                    const amount = parseFloat(this.getAttribute("data-amount"));

                    await supabaseClient.from("payments").update({ status: "confirmed" }).eq("id", id);
                    await supabaseClient.from("history").insert({
                        room_id: currentRoomId,
                        actor_id: user.id,
                        action: "payment_confirmed",
                        details: "Confirmed $" + amount.toFixed(2) + " paid by " + payerName,
                        related_type: "payment",
                        related_id: id,
                    });

                    await loadBalances();
                    await loadPendingPayments();
                });
            }

            const declineButtons = document.getElementsByClassName("decline-payment-btn");
            for (let i = 0; i < declineButtons.length; i++) {
                declineButtons[i].addEventListener("click", function () {
                    const id = this.getAttribute("data-id");
                    document.getElementById("decline-form-" + id).classList.toggle("open");
                });
            }

            const submitDeclineButtons = document.getElementsByClassName("submit-decline-btn");
            for (let i = 0; i < submitDeclineButtons.length; i++) {
                submitDeclineButtons[i].addEventListener("click", async function () {
                    const id = this.getAttribute("data-id");
                    const reasonInput = document.querySelector(".decline-reason-input[data-id='" + id + "']");
                    const reason = reasonInput.value.trim();

                    await supabaseClient.from("payments").update({ status: "declined" }).eq("id", id);
                    await supabaseClient.from("history").insert({
                        room_id: currentRoomId,
                        actor_id: user.id,
                        action: "payment_declined",
                        details: reason === "" ? "Declined a payment" : "Declined a payment: " + reason,
                        related_type: "payment",
                        related_id: id,
                    });

                    await loadPendingPayments();
                });
            }
        }

        const { data: sent, error: sentError } = await supabaseClient
            .from("payments")
            .select("id, recipient_id, amount, note")
            .eq("room_id", currentRoomId)
            .eq("payer_id", user.id)
            .eq("status", "pending");

        if (sentError || !sent || sent.length === 0) {
            sentPaymentsListDiv.innerHTML = "<p>Nothing pending.</p>";
        } else {
            sentPaymentsListDiv.innerHTML = "";
            for (let i = 0; i < sent.length; i++) {
                const p = sent[i];
                const recipientName = namesById[p.recipient_id] || "Unknown";
                sentPaymentsListDiv.innerHTML +=
                    "<div class='pending-payment-entry'><p>Waiting for " +
                    recipientName +
                    " to confirm $" +
                    Number(p.amount).toFixed(2) +
                    (p.note ? " — \"" + p.note + "\"" : "") +
                    "</p></div>";
            }
        }
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
    await loadPendingPayments();
    await loadAllExpenses();

    // Auto-refresh: re-run the relevant load functions whenever expenses,
    // splits, or payments in this room change, so balances and pending
    // payments update live. (Placed inside window.onload so currentRoomId
    // is in scope — an earlier copy of this block sat outside the
    // function, referenced functions that don't exist in this file, and
    // silently threw a ReferenceError on every page load.)
    supabaseClient
        .channel("room-" + currentRoomId + "-balances")
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "expenses", filter: "room_id=eq." + currentRoomId },
            function () {
                loadBalances();
                loadAllExpenses();
            }
        )
        .on("postgres_changes", { event: "*", schema: "public", table: "expense_splits" }, function () {
            loadBalances();
            loadAllExpenses();
        })
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "payments", filter: "room_id=eq." + currentRoomId },
            function () {
                loadBalances();
                loadPendingPayments();
            }
        )
        .subscribe();
};
