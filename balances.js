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

    // Escape user-provided text before inserting it into HTML.
    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    async function loadMemberNames() {
        const { data, error } = await supabaseClient
            .from("room_members")
            .select("user_id, profiles(name)")
            .eq("room_id", currentRoomId)
            .eq("is_active", true);

        if (error || !data) {
            console.error("Could not load room members:", error);
            return;
        }

        namesById = {};

        for (let i = 0; i < data.length; i++) {
            namesById[data[i].user_id] = data[i].profiles
                ? data[i].profiles.name
                : "Unknown";
        }
    }

    // Build a balance row and its payment form.
    function buildBalanceEntryHtml(entry, direction, hasPendingPayment) {
        const buttonLabel =
            direction === "owe" ? "I Paid This" : "They Paid Me";

        // You can't record another payment to someone while an earlier one is
        // still waiting for their confirmation. (The database enforces this
        // too; this just hides the button so it isn't offered.)
        if (direction === "owe" && hasPendingPayment) {
            return (
                "<div class='balance-row-wrapper'>" +
                "<div class='balance-row'><span>" +
                escapeHtml(entry.name) +
                "</span><span>$" +
                entry.amount.toFixed(2) +
                "</span></div>" +
                "<p class='pending-note'>Payment sent. Waiting for " +
                escapeHtml(entry.name) +
                " to confirm.</p>" +
                "</div>"
            );
        }

        return (
            "<div class='balance-row-wrapper'>" +
            "<div class='balance-row'><span>" +
            escapeHtml(entry.name) +
            "</span><span>$" +
            entry.amount.toFixed(2) +
            "</span></div>" +
            "<button class='mark-paid-btn' data-id='" +
            escapeHtml(entry.id) +
            "'>" +
            buttonLabel +
            "</button>" +
            "<div class='mark-paid-form' id='pay-form-" +
            escapeHtml(entry.id) +
            "'>" +
            "<label>Amount</label>" +
            "<input class='mark-paid-amount-input' data-member-id='" +
            escapeHtml(entry.id) +
            "' value='" +
            entry.amount.toFixed(2) +
            "'>" +
            "<label>Note (optional)</label>" +
            "<input type='text' class='mark-paid-note-input' data-member-id='" +
            escapeHtml(entry.id) +
            "' placeholder='e.g. Venmo'>" +
            "<button class='submit-mark-paid-btn' data-id='" +
            escapeHtml(entry.id) +
            "' data-name='" +
            escapeHtml(entry.name) +
            "' data-direction='" +
            direction +
            "'>Submit</button>" +
            "<div class='mark-paid-error' id='pay-error-" +
            escapeHtml(entry.id) +
            "'></div>" +
            "</div>" +
            "</div>"
        );
    }

    function wireMarkPaidButtons() {
        const toggleButtons =
            document.getElementsByClassName("mark-paid-btn");

        for (let i = 0; i < toggleButtons.length; i++) {
            toggleButtons[i].addEventListener("click", function () {
                const id = this.getAttribute("data-id");
                const form = document.getElementById("pay-form-" + id);

                if (!form) {
                    return;
                }

                form.classList.toggle("open");

                if (!form.getAttribute("data-currency-attached")) {
                    const amountInput = form.querySelector(
                        ".mark-paid-amount-input"
                    );

                    attachCurrencyInput(amountInput);
                    amountInput.value = "$" + amountInput.value;

                    form.setAttribute("data-currency-attached", "true");
                }
            });
        }

        const submitButtons =
            document.getElementsByClassName("submit-mark-paid-btn");

        for (let i = 0; i < submitButtons.length; i++) {
            submitButtons[i].addEventListener("click", async function () {
                const otherId = this.getAttribute("data-id");
                const otherName = this.getAttribute("data-name");
                const direction = this.getAttribute("data-direction");

                this.disabled = true;

                try {
                    await submitMarkPaid(otherId, otherName, direction);
                } finally {
                    this.disabled = false;
                }
            });
        }
    }

    async function submitMarkPaid(otherId, otherName, direction) {
        const errorDiv = document.getElementById("pay-error-" + otherId);

        const amountInput = document.querySelector(
            ".mark-paid-amount-input[data-member-id='" + otherId + "']"
        );

        const noteInput = document.querySelector(
            ".mark-paid-note-input[data-member-id='" + otherId + "']"
        );

        if (!errorDiv || !amountInput || !noteInput) {
            window.alert("Could not find the payment form. Please refresh.");
            return;
        }

        errorDiv.textContent = "";

        const amount = getCurrencyValue(amountInput);

        if (!Number.isFinite(amount) || amount <= 0) {
            errorDiv.textContent = "Enter a valid amount greater than zero.";
            return;
        }

        const note = noteInput.value.trim();

        const payerId = direction === "owe" ? user.id : otherId;
        const recipientId = direction === "owe" ? otherId : user.id;

        const rpcName =
            direction === "owe"
                ? "record_outgoing_payment"
                : "record_received_payment";

        const rpcArgs =
            direction === "owe"
                ? {
                      room_id_input: currentRoomId,
                      recipient_id_input: recipientId,
                      amount_input: amount,
                      note_input: note === "" ? null : note,
                  }
                : {
                      room_id_input: currentRoomId,
                      payer_id_input: payerId,
                      amount_input: amount,
                      note_input: note === "" ? null : note,
                  };

        const { error } = await supabaseClient.rpc(rpcName, rpcArgs);

        if (error) {
            console.error("Could not record payment:", error);
            errorDiv.textContent =
                error.message ||
                "Could not record this payment. Please try again.";
            return;
        }

        await loadBalances();
        await loadPendingPayments();
    }

    async function loadBalances() {
        // The calculation lives in balanceCalc.js so the dashboard and this
        // page always agree.
        const result = await loadNetBalances(currentRoomId, user.id);

        if (result.error) {
            balanceSummaryDiv.textContent =
                "Something went wrong loading balances. Please refresh.";
            return;
        }

        const summary = summarizeBalances(result.netCents);

        // Who do I already have an unconfirmed payment waiting with?
        const pendingTo = {};
        const { data: pendingOut, error: pendingOutError } =
            await supabaseClient
                .from("payments")
                .select("recipient_id")
                .eq("room_id", currentRoomId)
                .eq("payer_id", user.id)
                .eq("status", "pending");

        if (pendingOutError) {
            console.error("Could not check pending payments:", pendingOutError);
        } else {
            for (let i = 0; i < pendingOut.length; i++) {
                pendingTo[pendingOut[i].recipient_id] = true;
            }
        }

        const owesEntries = summary.owes.map(function (entry) {
            return {
                name: namesById[entry.id] || "Unknown",
                amount: entry.amount,
                id: entry.id,
            };
        });
        const owedEntries = summary.owed.map(function (entry) {
            return {
                name: namesById[entry.id] || "Unknown",
                amount: entry.amount,
                id: entry.id,
            };
        });

        // Render the "You Owe" section.
        if (owesEntries.length === 0) {
            owesListDiv.innerHTML =
                "<p>You don't owe anyone right now.</p>";
        } else {
            owesListDiv.innerHTML = "";

            for (let i = 0; i < owesEntries.length; i++) {
                owesListDiv.innerHTML += buildBalanceEntryHtml(
                    owesEntries[i],
                    "owe",
                    !!pendingTo[owesEntries[i].id]
                );
            }
        }

        // Render the "Owed to You" section.
        if (owedEntries.length === 0) {
            owedListDiv.innerHTML =
                "<p>No one owes you anything right now.</p>";
        } else {
            owedListDiv.innerHTML = "";

            for (let i = 0; i < owedEntries.length; i++) {
                owedListDiv.innerHTML += buildBalanceEntryHtml(
                    owedEntries[i],
                    "owed"
                );
            }
        }

        wireMarkPaidButtons();

        const totalOwed = summary.totalOwed;
        const totalOwedToYou = summary.totalOwedToYou;
        const netTotal = summary.netTotal;

        balanceSummaryDiv.innerHTML = summary.settled
            ? "<p><strong>\u2705 All settled up. Nobody owes anything right now.</strong></p>"
            : "<p>You owe a total of $" +
              totalOwed.toFixed(2) +
              "</p><p>You are owed a total of $" +
              totalOwedToYou.toFixed(2) +
              "</p><p><strong>Net: " +
              (netTotal >= 0
                  ? "+$" + netTotal.toFixed(2)
                  : "-$" + Math.abs(netTotal).toFixed(2)) +
              "</strong></p>";
    }

    async function loadPendingPayments() {
        const { data: awaiting, error: awaitingError } =
            await supabaseClient
                .from("payments")
                .select("id, payer_id, amount, note")
                .eq("room_id", currentRoomId)
                .eq("recipient_id", user.id)
                .eq("status", "pending");

        if (awaitingError) {
            console.error("Could not load incoming payments:", awaitingError);
            awaitingConfirmationListDiv.textContent =
                "Could not load payments waiting for your confirmation.";
        } else if (!awaiting || awaiting.length === 0) {
            awaitingConfirmationListDiv.innerHTML =
                "<p>Nothing waiting on you right now.</p>";
        } else {
            awaitingConfirmationListDiv.innerHTML = "";

            for (let i = 0; i < awaiting.length; i++) {
                const payment = awaiting[i];
                const payerName =
                    namesById[payment.payer_id] || "Unknown";

                awaitingConfirmationListDiv.innerHTML +=
                    "<div class='pending-payment-entry'>" +
                    "<p>" +
                    escapeHtml(payerName) +
                    " says they paid you $" +
                    Number(payment.amount).toFixed(2) +
                    (payment.note
                        ? " — \"" + escapeHtml(payment.note) + "\""
                        : "") +
                    "</p>" +
                    "<button class='confirm-payment-btn' data-id='" +
                    escapeHtml(payment.id) +
                    "'>Confirm</button>" +
                    "<button class='decline-payment-btn' data-id='" +
                    escapeHtml(payment.id) +
                    "'>Decline</button>" +
                    "<div class='decline-form' id='decline-form-" +
                    escapeHtml(payment.id) +
                    "'>" +
                    "<label>Reason (optional)</label>" +
                    "<input type='text' class='decline-reason-input' data-id='" +
                    escapeHtml(payment.id) +
                    "' placeholder='e.g. I never received this'>" +
                    "<button class='submit-decline-btn' data-id='" +
                    escapeHtml(payment.id) +
                    "'>Submit Decline</button>" +
                    "</div>" +
                    "</div>";
            }

            const confirmButtons =
                document.getElementsByClassName("confirm-payment-btn");

            for (let i = 0; i < confirmButtons.length; i++) {
                confirmButtons[i].addEventListener(
                    "click",
                    async function () {
                        const id = this.getAttribute("data-id");

                        this.disabled = true;

                        try {
                            const { error } = await supabaseClient.rpc(
                                "respond_to_payment",
                                {
                                    payment_id_input: id,
                                    new_status_input: "confirmed",
                                    reason_input: null,
                                }
                            );

                            if (error) {
                                console.error(
                                    "Could not confirm payment:",
                                    error
                                );

                                window.alert(
                                    error.message ||
                                        "Could not confirm this payment."
                                );
                                return;
                            }

                            await loadBalances();
                            await loadPendingPayments();
                        } finally {
                            this.disabled = false;
                        }
                    }
                );
            }

            const declineButtons =
                document.getElementsByClassName("decline-payment-btn");

            for (let i = 0; i < declineButtons.length; i++) {
                declineButtons[i].addEventListener(
                    "click",
                    function () {
                        const id = this.getAttribute("data-id");
                        const form = document.getElementById(
                            "decline-form-" + id
                        );

                        if (form) {
                            form.classList.toggle("open");
                        }
                    }
                );
            }

            const submitDeclineButtons =
                document.getElementsByClassName("submit-decline-btn");

            for (let i = 0; i < submitDeclineButtons.length; i++) {
                submitDeclineButtons[i].addEventListener(
                    "click",
                    async function () {
                        const id = this.getAttribute("data-id");

                        const reasonInput = document.querySelector(
                            ".decline-reason-input[data-id='" + id + "']"
                        );

                        const reason = reasonInput
                            ? reasonInput.value.trim()
                            : "";

                        this.disabled = true;

                        try {
                            const { error } = await supabaseClient.rpc(
                                "respond_to_payment",
                                {
                                    payment_id_input: id,
                                    new_status_input: "declined",
                                    reason_input:
                                        reason === "" ? null : reason,
                                }
                            );

                            if (error) {
                                console.error(
                                    "Could not decline payment:",
                                    error
                                );

                                window.alert(
                                    error.message ||
                                        "Could not decline this payment."
                                );
                                return;
                            }

                            await loadPendingPayments();
                        } finally {
                            this.disabled = false;
                        }
                    }
                );
            }
        }

        // Show payments that the current user has sent and that are still pending.
        const { data: sent, error: sentError } = await supabaseClient
            .from("payments")
            .select("id, recipient_id, amount, note")
            .eq("room_id", currentRoomId)
            .eq("payer_id", user.id)
            .eq("status", "pending");

        if (sentError) {
            console.error("Could not load sent payments:", sentError);
            sentPaymentsListDiv.textContent =
                "Could not load your pending payments.";
        } else if (!sent || sent.length === 0) {
            sentPaymentsListDiv.innerHTML = "<p>Nothing pending.</p>";
        } else {
            sentPaymentsListDiv.innerHTML = "";

            for (let i = 0; i < sent.length; i++) {
                const payment = sent[i];
                const recipientName =
                    namesById[payment.recipient_id] || "Unknown";

                sentPaymentsListDiv.innerHTML +=
                    "<div class='pending-payment-entry'><p>Waiting for " +
                    escapeHtml(recipientName) +
                    " to confirm $" +
                    Number(payment.amount).toFixed(2) +
                    (payment.note
                        ? " — \"" + escapeHtml(payment.note) + "\""
                        : "") +
                    "</p></div>";
            }
        }
    }

    async function loadAllExpenses() {
        const { data, error } = await supabaseClient
            .from("expenses")
            .select(
                "id, name, amount, paid_by, date, expense_splits(user_id, amount_owed, payment_status)"
            )
            .eq("room_id", currentRoomId)
            .order("date", { ascending: false });

        if (error) {
            console.error("Could not load expense history:", error);
            allExpensesListDiv.textContent =
                "Something went wrong loading expenses.";
            return;
        }

        if (!data || data.length === 0) {
            allExpensesListDiv.innerHTML = "<p>No expenses added</p>";
            return;
        }

        allExpensesListDiv.innerHTML = "";

        for (let i = 0; i < data.length; i++) {
            const expense = data[i];
            const payerName =
                namesById[expense.paid_by] || "Unknown";

            let splitsHtml = "";

            for (let j = 0; j < expense.expense_splits.length; j++) {
                const split = expense.expense_splits[j];
                const name = namesById[split.user_id] || "Unknown";

                splitsHtml +=
                    escapeHtml(name) +
                    ": $" +
                    Number(split.amount_owed).toFixed(2) +
                    (split.payment_status === "paid"
                        ? " (paid)"
                        : " (unpaid)") +
                    "<br>";
            }

            allExpensesListDiv.innerHTML +=
                "<div class='expense-entry'><h3>" +
                escapeHtml(expense.name) +
                " — $" +
                Number(expense.amount).toFixed(2) +
                " (" +
                escapeHtml(expense.date) +
                ")</h3>" +
                "<p>Paid by: " +
                escapeHtml(payerName) +
                "</p><p>" +
                splitsHtml +
                "</p></div>";
        }
    }

    // Ensure a user and room have been selected before querying room data.
    if (!user || !currentRoomId) {
        window.location.href = "room-select.html";
        return;
    }

    await loadMemberNames();
    await loadBalances();
    await loadPendingPayments();
    await loadAllExpenses();

    // Refresh the page's data when records change in this room.
    supabaseClient
        .channel("room-" + currentRoomId + "-balances")
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "expenses",
                filter: "room_id=eq." + currentRoomId,
            },
            function () {
                loadBalances();
                loadAllExpenses();
            }
        )
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "expense_splits",
            },
            function () {
                loadBalances();
                loadAllExpenses();
            }
        )
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "payments",
                filter: "room_id=eq." + currentRoomId,
            },
            function () {
                loadBalances();
                loadPendingPayments();
            }
        )
        .subscribe();
};