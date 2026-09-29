/*
Name: Naman Agrawal
This is balances.js. It calculates the logged-in user's balances within
the current room (net of confirmed payments), shows the full expense list
for the room, and handles payments: the person who owes marking "I Paid
This" (goes to pending, needs the other roommate's confirmation), and the
person who was paid marking "They Paid Me" (recorded as already
confirmed, since they're reporting a payment made to themselves). It also
subscribes to Supabase Realtime so balances update automatically instead
of requiring a manual reload.
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
    const awaitingConfirmationDiv = document.getElementById("awaiting-confirmation-list");
    const sentPaymentsDiv = document.getElementById("sent-payments-list");

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

    async function loadConfirmedPayments() {
        const { data, error } = await supabaseClient
            .from("payments")
            .select("payer_id, recipient_id, amount")
            .eq("room_id", currentRoomId)
            .eq("status", "confirmed");

        if (error || !data) {
            return [];
        }
        return data;
    }

    function wireMarkPaidButtons() {
        const toggleButtons = document.getElementsByClassName("mark-paid-btn");
        for (let i = 0; i < toggleButtons.length; i++) {
            toggleButtons[i].addEventListener("click", function () {
                const id = this.getAttribute("data-recipient-id");
                document.getElementById("mark-paid-form-" + id).classList.toggle("open");
            });
        }

        const submitButtons = document.getElementsByClassName("submit-mark-paid-btn");
        for (let i = 0; i < submitButtons.length; i++) {
            submitButtons[i].addEventListener("click", async function () {
                const recipientId = this.getAttribute("data-recipient-id");
                const recipientName = this.getAttribute("data-name");
                const amountInput = document.getElementById("mark-paid-amount-" + recipientId);
                const noteInput = document.getElementById("mark-paid-note-" + recipientId);
                const errorDiv = document.getElementById("mark-paid-error-" + recipientId);
                const amount = getCurrencyValue(amountInput);

                errorDiv.innerHTML = "";

                if (isNaN(amount) || amount <= 0) {
                    errorDiv.innerHTML = "<p>Enter a valid amount.</p>";
                    return;
                }

                this.disabled = true;

                const { data, error } = await supabaseClient
                    .from("payments")
                    .insert({
                        room_id: currentRoomId,
                        payer_id: user.id,
                        recipient_id: recipientId,
                        amount: amount,
                        note: noteInput.value.trim() === "" ? null : noteInput.value.trim(),
                    })
                    .select()
                    .single();

                this.disabled = false;

                if (error) {
                    errorDiv.innerHTML = "<p>" + error.message + "</p>";
                    return;
                }

                await supabaseClient.from("history").insert({
                    room_id: currentRoomId,
                    actor_id: user.id,
                    action: "payment_marked_paid",
                    details: "$" + amount.toFixed(2) + " marked as paid to " + recipientName,
                    related_type: "payment",
                    related_id: data.id,
                });

                await loadPendingPayments();
            });
        }
    }

    // "They Paid Me" — for the case where the payer didn't (or can't) use
    // the app themselves. The recipient self-reports the payment, so it's
    // inserted already "confirmed" rather than going through the pending
    // confirmation flow. Requires the "add room payments" RLS policy from
    // schema_fixes_2.sql to allow the RECIPIENT to insert, not just the
    // payer — without that migration this insert will fail with an RLS
    // error.
    function wireMarkReceivedButtons() {
        const toggleButtons = document.getElementsByClassName("mark-received-btn");
        for (let i = 0; i < toggleButtons.length; i++) {
            toggleButtons[i].addEventListener("click", function () {
                const id = this.getAttribute("data-payer-id");
                document.getElementById("mark-received-form-" + id).classList.toggle("open");
            });
        }

        const submitButtons = document.getElementsByClassName("submit-mark-received-btn");
        for (let i = 0; i < submitButtons.length; i++) {
            submitButtons[i].addEventListener("click", async function () {
                const payerId = this.getAttribute("data-payer-id");
                const payerName = this.getAttribute("data-name");
                const amountInput = document.getElementById("mark-received-amount-" + payerId);
                const errorDiv = document.getElementById("mark-received-error-" + payerId);
                const amount = getCurrencyValue(amountInput);

                errorDiv.innerHTML = "";

                if (isNaN(amount) || amount <= 0) {
                    errorDiv.innerHTML = "<p>Enter a valid amount.</p>";
                    return;
                }

                this.disabled = true;

                const { data, error } = await supabaseClient
                    .from("payments")
                    .insert({
                        room_id: currentRoomId,
                        payer_id: payerId,
                        recipient_id: user.id,
                        amount: amount,
                        status: "confirmed",
                        responded_at: new Date().toISOString(),
                    })
                    .select()
                    .single();

                this.disabled = false;

                if (error) {
                    errorDiv.innerHTML = "<p>" + error.message + "</p>";
                    return;
                }

                await supabaseClient.from("history").insert({
                    room_id: currentRoomId,
                    actor_id: user.id,
                    action: "payment_confirmed",
                    details: "$" + amount.toFixed(2) + " payment from " + payerName + " recorded",
                    related_type: "payment",
                    related_id: data.id,
                });

                await loadBalances();
            });
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

        const confirmedPayments = await loadConfirmedPayments();

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

        // Confirmed payments reduce the running balance directly rather
        // than marking individual expense_splits as paid — a deliberate
        // scope decision (see balance-note copy on the page).
        for (let i = 0; i < confirmedPayments.length; i++) {
            const payment = confirmedPayments[i];
            const amount = Number(payment.amount);

            if (payment.payer_id === user.id) {
                net[payment.recipient_id] = (net[payment.recipient_id] || 0) + amount;
            } else if (payment.recipient_id === user.id) {
                net[payment.payer_id] = (net[payment.payer_id] || 0) - amount;
            }
        }

        const owesEntries = [];
        const owedEntries = [];

        for (const otherId in net) {
            const amount = net[otherId];
            const name = namesById[otherId] || "Unknown";
            if (amount > 0.004) {
                owedEntries.push({ id: otherId, name: name, amount: amount });
            } else if (amount < -0.004) {
                owesEntries.push({ id: otherId, name: name, amount: -amount });
            }
        }

        if (owesEntries.length === 0) {
            owesListDiv.innerHTML = "<p>You don't owe anyone right now.</p>";
        } else {
            owesListDiv.innerHTML = "";
            for (let i = 0; i < owesEntries.length; i++) {
                const entry = owesEntries[i];
                owesListDiv.innerHTML +=
                    "<div class='balance-row'><span>" +
                    entry.name +
                    "</span><span>$" +
                    entry.amount.toFixed(2) +
                    "</span></div>" +
                    "<button class='mark-paid-btn' data-recipient-id='" +
                    entry.id +
                    "'>I Paid This</button>" +
                    "<div class='mark-paid-form' id='mark-paid-form-" +
                    entry.id +
                    "'>" +
                    "<label>Amount paid:</label>" +
                    "<input class='mark-paid-amount' id='mark-paid-amount-" +
                    entry.id +
                    "' value='" +
                    entry.amount.toFixed(2) +
                    "'>" +
                    "<label>Note (optional):</label>" +
                    "<input type='text' class='mark-paid-note' id='mark-paid-note-" +
                    entry.id +
                    "'>" +
                    "<button class='submit-mark-paid-btn' data-recipient-id='" +
                    entry.id +
                    "' data-name='" +
                    entry.name +
                    "'>Submit</button>" +
                    "<div class='mark-paid-error' id='mark-paid-error-" +
                    entry.id +
                    "'></div>" +
                    "</div>";
            }
        }

        if (owedEntries.length === 0) {
            owedListDiv.innerHTML = "<p>No one owes you anything right now.</p>";
        } else {
            owedListDiv.innerHTML = "";
            for (let i = 0; i < owedEntries.length; i++) {
                const entry = owedEntries[i];
                owedListDiv.innerHTML +=
                    "<div class='balance-row'><span>" +
                    entry.name +
                    "</span><span>$" +
                    entry.amount.toFixed(2) +
                    "</span></div>" +
                    "<button class='mark-received-btn' data-payer-id='" +
                    entry.id +
                    "'>They Paid Me</button>" +
                    "<div class='mark-paid-form' id='mark-received-form-" +
                    entry.id +
                    "'>" +
                    "<label>Amount received:</label>" +
                    "<input class='mark-received-amount' id='mark-received-amount-" +
                    entry.id +
                    "' value='" +
                    entry.amount.toFixed(2) +
                    "'>" +
                    "<button class='submit-mark-received-btn' data-payer-id='" +
                    entry.id +
                    "' data-name='" +
                    entry.name +
                    "'>Submit</button>" +
                    "<div class='mark-paid-error' id='mark-received-error-" +
                    entry.id +
                    "'></div>" +
                    "</div>";
            }
        }

        // New inputs were just written into the DOM — wire the $ formatting
        // for them before the person starts typing.
        const currencyFields = document.querySelectorAll(".mark-paid-amount, .mark-received-amount");
        for (let i = 0; i < currencyFields.length; i++) {
            attachCurrencyInput(currencyFields[i]);
        }

        wireMarkPaidButtons();
        wireMarkReceivedButtons();

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

    function wirePendingPaymentButtons() {
        const confirmButtons = document.getElementsByClassName("confirm-payment-btn");
        for (let i = 0; i < confirmButtons.length; i++) {
            confirmButtons[i].addEventListener("click", async function () {
                const id = this.getAttribute("data-id");
                const amount = this.getAttribute("data-amount");
                const payerName = this.getAttribute("data-payer-name");

                this.disabled = true;

                const { error } = await supabaseClient
                    .from("payments")
                    .update({ status: "confirmed", responded_at: new Date().toISOString() })
                    .eq("id", id);

                if (error) {
                    this.disabled = false;
                    return;
                }

                await supabaseClient.from("history").insert({
                    room_id: currentRoomId,
                    actor_id: user.id,
                    action: "payment_confirmed",
                    details: "$" + Number(amount).toFixed(2) + " payment from " + payerName + " confirmed",
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
                const amount = this.getAttribute("data-amount");
                const payerName = this.getAttribute("data-payer-name");
                const reasonInput = document.getElementById("decline-reason-" + id);
                const reason = reasonInput.value.trim();

                this.disabled = true;

                const { error } = await supabaseClient
                    .from("payments")
                    .update({
                        status: "declined",
                        decline_reason: reason === "" ? null : reason,
                        responded_at: new Date().toISOString(),
                    })
                    .eq("id", id);

                if (error) {
                    this.disabled = false;
                    return;
                }

                await supabaseClient.from("history").insert({
                    room_id: currentRoomId,
                    actor_id: user.id,
                    action: "payment_declined",
                    details:
                        "$" +
                        Number(amount).toFixed(2) +
                        " payment from " +
                        payerName +
                        " declined" +
                        (reason === "" ? "" : ": " + reason),
                    related_type: "payment",
                    related_id: id,
                });

                await loadPendingPayments();
            });
        }
    }

    async function loadPendingPayments() {
        const { data, error } = await supabaseClient
            .from("payments")
            .select("id, payer_id, recipient_id, amount, note, date, status")
            .eq("room_id", currentRoomId)
            .eq("status", "pending")
            .order("date", { ascending: false });

        if (error || !data) {
            awaitingConfirmationDiv.innerHTML = "<p>Something went wrong loading pending payments.</p>";
            sentPaymentsDiv.innerHTML = "";
            return;
        }

        const toConfirm = data.filter(function (p) {
            return p.recipient_id === user.id;
        });
        const sent = data.filter(function (p) {
            return p.payer_id === user.id;
        });

        if (toConfirm.length === 0) {
            awaitingConfirmationDiv.innerHTML = "<p>Nothing waiting on your confirmation.</p>";
        } else {
            awaitingConfirmationDiv.innerHTML = "";
            for (let i = 0; i < toConfirm.length; i++) {
                const p = toConfirm[i];
                const payerName = namesById[p.payer_id] || "Unknown";
                awaitingConfirmationDiv.innerHTML +=
                    "<div class='pending-payment-entry'>" +
                    "<p>" +
                    payerName +
                    " marked <strong>$" +
                    Number(p.amount).toFixed(2) +
                    "</strong> as paid to you (" +
                    p.date +
                    ")" +
                    (p.note ? "<br><em>" + p.note + "</em>" : "") +
                    "</p>" +
                    "<button class='confirm-payment-btn' data-id='" +
                    p.id +
                    "' data-amount='" +
                    p.amount +
                    "' data-payer-name='" +
                    payerName +
                    "'>Confirm</button>" +
                    "<button class='decline-payment-btn' data-id='" +
                    p.id +
                    "'>Decline</button>" +
                    "<div class='decline-form' id='decline-form-" +
                    p.id +
                    "'>" +
                    "<label>Reason (optional):</label>" +
                    "<input type='text' id='decline-reason-" +
                    p.id +
                    "'>" +
                    "<button class='submit-decline-btn' data-id='" +
                    p.id +
                    "' data-amount='" +
                    p.amount +
                    "' data-payer-name='" +
                    payerName +
                    "'>Submit Decline</button>" +
                    "</div>" +
                    "</div>";
            }
        }

        if (sent.length === 0) {
            sentPaymentsDiv.innerHTML = "<p>No payments waiting on confirmation.</p>";
        } else {
            sentPaymentsDiv.innerHTML = "";
            for (let i = 0; i < sent.length; i++) {
                const p = sent[i];
                const recipientName = namesById[p.recipient_id] || "Unknown";
                sentPaymentsDiv.innerHTML +=
                    "<div class='pending-payment-entry'><p>You marked $" +
                    Number(p.amount).toFixed(2) +
                    " as paid to " +
                    recipientName +
                    " — waiting for confirmation (" +
                    p.date +
                    ")</p></div>";
            }
        }

        wirePendingPaymentButtons();
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

    // Auto-refresh: recompute balances whenever an expense, split, or
    // payment changes anywhere in the room. This MUST live inside
    // window.onload — currentRoomId is declared with const at the top of
    // this function, so it doesn't exist outside it, and the functions
    // referenced below (loadBalances, loadAllExpenses, loadPendingPayments)
    // are also only defined in here.
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

    await loadMemberNames();
    await loadBalances();
    await loadAllExpenses();
    await loadPendingPayments();
};