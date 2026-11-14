/*
Name: Naman Agrawal
This is main.js. It loads the current room's members, a balance summary,
the 3 most recent expenses, and an open-chores preview from Supabase, and
handles adding new expenses (equal or custom-dollar split). It also
subscribes to Supabase Realtime so the dashboard updates automatically
when anyone in the room adds an expense or chore, instead of requiring a
manual page reload.
*/
window.onload = async function () {
    const currentRoomId = localStorage.getItem("currentRoomId");
    const {
        data: { user },
    } = await supabaseClient.auth.getUser();

    let members = []; // [{ id, name, role }]
    let membersById = {};

    // Escape user-provided text before inserting it into HTML.
    function escapeHtml(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

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
    const balanceSummaryMiniDiv = document.getElementById("balance-summary-mini");
    const choreListDiv = document.getElementById("chore-list");
    const amountInput = document.getElementById("amount");
    const splitEqualRadio = document.getElementById("split-equal");
    const splitCustomRadio = document.getElementById("split-custom");
    const customSplitSection = document.getElementById("custom-split-section");
    const customSplitInputs = document.getElementById("custom-split-inputs");
    const customSplitRemaining = document.getElementById("custom-split-remaining");


    attachCurrencyInput(amountInput);

    // Expand/close the split-expense area. (Uses a plain flag instead of
    // reading style.display back, since CSS — not inline style — is what
    // hides the form initially.)
    let expenseFormOpen = false;
    function setExpenseSheet(open) {
        expenseFormOpen = open;
        splitExpenseForm.style.display = open ? "block" : "none";
        splitExpenseExpand.innerHTML = open ? " - Split an Expense" : "+ Split an Expense";
        document.body.classList.toggle("sheet-open", open);
        if (open) {
            amountInput.focus();
        }
    }
    splitExpenseExpand.addEventListener("click", function () {
        setExpenseSheet(!expenseFormOpen);
    });
    document.getElementById("quick-add-expense").addEventListener("click", function () {
        setExpenseSheet(true);
    });
    document.getElementById("expense-close").addEventListener("click", function () {
        setExpenseSheet(false);
    });
    document.getElementById("sheet-backdrop").addEventListener("click", function () {
        setExpenseSheet(false);
    });
    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && expenseFormOpen) {
            setExpenseSheet(false);
        }
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

        // Preserve any amounts already typed in, keyed by member id. Read
        // through getCurrencyValue so a re-render doesn't double up a "$"
        // that attachCurrencyInput already added.
        const existingValues = {};
        const existingInputs = document.getElementsByClassName("custom-amount-input");
        for (let i = 0; i < existingInputs.length; i++) {
            const memberId = existingInputs[i].getAttribute("data-member-id");
            const value = getCurrencyValue(existingInputs[i]);
            existingValues[memberId] = isNaN(value) ? "" : value;
        }

        customSplitInputs.innerHTML = "";
        for (let i = 0; i < selectedIds.length; i++) {
            const memberId = selectedIds[i];
            const name = membersById[memberId] || "Unknown";
            const prevValue = existingValues[memberId] === undefined ? "" : existingValues[memberId];
            customSplitInputs.innerHTML +=
                "<div class='custom-split-row'><label>" +
                escapeHtml(name) +
                "</label><input class='custom-amount-input' " +
                "data-member-id='" +
                escapeHtml(memberId) +
                "' value='" +
                escapeHtml(prevValue) +
                "' placeholder='$0.00'></div>";
        }

        const newInputs = document.getElementsByClassName("custom-amount-input");
        for (let i = 0; i < newInputs.length; i++) {
            attachCurrencyInput(newInputs[i]);
            newInputs[i].addEventListener("input", updateRemainingDisplay);
        }

        updateRemainingDisplay();
    }

    function updateRemainingDisplay() {
        const total = getCurrencyValue(amountInput) || 0;
        const inputs = document.getElementsByClassName("custom-amount-input");
        let sum = 0;
        for (let i = 0; i < inputs.length; i++) {
            const value = getCurrencyValue(inputs[i]);
            sum += isNaN(value) ? 0 : value;
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

    function initialsOf(name) {
        return String(name || "?")
            .split(" ")
            .filter(Boolean)
            .map(function (part) {
                return part[0];
            })
            .join("")
            .slice(0, 2)
            .toUpperCase();
    }

    function timeAgo(isoString) {
        const seconds = Math.max(0, (Date.now() - new Date(isoString).getTime()) / 1000);
        if (seconds < 60) return "Just now";
        if (seconds < 3600) return Math.floor(seconds / 60) + " min ago";
        if (seconds < 86400) return Math.floor(seconds / 3600) + " hr ago";
        if (seconds < 172800) return "Yesterday";
        return new Date(isoString).toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }

    function renderGreeting() {
        const meta = user.user_metadata || {};
        const full = meta.name || meta.full_name || "";
        const first = full.split(" ")[0];
        const hour = new Date().getHours();
        const part = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
        document.getElementById("greeting").textContent = part + (first ? ", " + first + "." : ".");
        document.getElementById("today-label").textContent = new Date().toLocaleDateString(undefined, {
            weekday: "long",
            month: "long",
            day: "numeric",
        });
        const roomName = localStorage.getItem("currentRoomName");
        document.getElementById("hero-sub").textContent = roomName
            ? "Here is what is happening at " + roomName + "."
            : "Here is what is happening at your home.";
    }

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
            "<h3>" + members.length + (members.length === 1 ? " roommate" : " roommates") + "</h3>";

        roommateList.innerHTML = "";
        for (let i = 0; i < members.length; i++) {
            roommateList.innerHTML +=
                "<p><span class='avatar a" + (i % 3 + 1) + "' aria-hidden='true'>" +
                escapeHtml(initialsOf(members[i].name)) +
                "</span>" +
                escapeHtml(members[i].name) +
                (members[i].id === user.id ? " (you)" : "") +
                (members[i].role === "owner" ? " (owner)" : "") +
                "</p>";
        }

        splitCheckboxes.innerHTML = "";
        for (let i = 0; i < members.length; i++) {
            splitCheckboxes.innerHTML +=
                '<label><input type="checkbox" class="roommate-checkbox" value="' +
                escapeHtml(members[i].id) +
                '" checked> ' +
                escapeHtml(members[i].name) +
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
                "<option value='" + escapeHtml(members[i].id) + "' " + selectedAttr + ">" + escapeHtml(members[i].name) + "</option>";
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
                    "<p>Invite code (share with roommates): <strong>" + escapeHtml(roomData.invite_code) + "</strong></p>";
            }
        } else {
            inviteInfo.innerHTML = "";
        }
    }

    async function loadBalanceSummary() {
        // Same shared calculation the Balances page uses (balanceCalc.js),
        // so the two can never disagree.
        const result = await loadNetBalances(currentRoomId, user.id);

        if (result.error) {
            balanceSummaryMiniDiv.innerHTML = "<p>Could not load balance. Try refreshing.</p>";
            return;
        }

        const summary = summarizeBalances(result.netCents);

        if (summary.settled) {
            balanceSummaryMiniDiv.innerHTML =
                "<div class='settled-card'><span aria-hidden='true'>\u2705</span> All settled up. Nobody owes anything.</div>";
            return;
        }

        // Labels, not color alone, say which direction the money goes.
        balanceSummaryMiniDiv.innerHTML =
            "<div class='balance-cards'>" +
            "<article class='bal-card owe'><p class='tag'>You owe</p><p class='amount'>$" +
            summary.totalOwed.toFixed(2) +
            "</p><p class='sub'>" +
            (summary.totalOwed > 0 ? "Open the balances page to record a payment" : "Nothing to pay right now") +
            "</p></article>" +
            "<article class='bal-card owed'><p class='tag'>Owed to you</p><p class='amount'>$" +
            summary.totalOwedToYou.toFixed(2) +
            "</p><p class='sub'>" +
            (summary.totalOwedToYou > 0 ? "Confirm payments as they arrive" : "Nobody owes you right now") +
            "</p></article>" +
            "</div>";
    }

    async function loadChoresPreview() {
        const { data, error } = await supabaseClient
            .from("chores")
            .select("id, name, assigned_to, due_date")
            .eq("room_id", currentRoomId)
            .eq("status", "open")
            .order("due_date", { ascending: true });

        if (error) {
            choreListDiv.innerHTML = "<p>Could not load chores. Try refreshing.</p>";
            return;
        }
        if (!data || data.length === 0) {
            choreListDiv.innerHTML = "<p>No chores yet. <a href='chores.html'>Add the first one</a>.</p>";
            return;
        }

        // Your own chores first, then everyone else's; show the next five.
        const sorted = data.slice().sort(function (x, y) {
            return (x.assigned_to === user.id ? 0 : 1) - (y.assigned_to === user.id ? 0 : 1);
        });
        const shown = sorted.slice(0, 5);

        choreListDiv.innerHTML = "";
        for (let i = 0; i < shown.length; i++) {
            const chore = shown[i];
            const who = chore.assigned_to === user.id ? "You" : membersById[chore.assigned_to] || "Unassigned";
            choreListDiv.innerHTML +=
                "<div class='chore-entry'><h3>" +
                escapeHtml(chore.name) +
                "</h3><p>Assigned to: " +
                escapeHtml(who) +
                "</p><p>Due: " +
                escapeHtml(chore.due_date || "No due date") +
                "</p></div>";
        }
        if (data.length > shown.length) {
            choreListDiv.innerHTML +=
                "<p><a href='chores.html'>" + (data.length - shown.length) + " more on the chores page</a></p>";
        }
    }

    // "Needs your attention": payments waiting on you, join requests (owner),
    // and your chores due today or overdue. Each card links to the page that
    // already has the real action, so nothing is duplicated here.
    async function loadAttention() {
        const list = document.getElementById("attention-list");
        const countPill = document.getElementById("attention-count");
        const items = [];
        const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
        let failed = false;

        const paymentsRes = await supabaseClient
            .from("payments")
            .select("id, payer_id, amount")
            .eq("room_id", currentRoomId)
            .eq("recipient_id", user.id)
            .eq("status", "pending");
        if (paymentsRes.error) {
            failed = true;
        } else {
            (paymentsRes.data || []).forEach(function (p) {
                items.push({
                    label: "Payment to confirm",
                    title: (membersById[p.payer_id] || "A roommate") + " paid you $" + Number(p.amount).toFixed(2),
                    detail: "Confirm once the money has arrived",
                    action: "Review",
                    href: "balances.html#payments",
                    tone: "green",
                });
            });
        }

        const me = members.find(function (x) {
            return x.id === user.id;
        });
        if (me && me.role === "owner") {
            const reqRes = await supabaseClient
                .from("room_join_requests")
                .select("id", { count: "exact", head: true })
                .eq("room_id", currentRoomId)
                .eq("status", "pending");
            if (!reqRes.error && reqRes.count) {
                items.push({
                    label: "Join request",
                    title: reqRes.count + (reqRes.count === 1 ? " person wants" : " people want") + " to join",
                    detail: "Approve or deny from notifications",
                    action: "Review",
                    href: "notifications.html",
                    tone: "green",
                });
            }
        }

        const choresRes = await supabaseClient
            .from("chores")
            .select("id, name, due_date")
            .eq("room_id", currentRoomId)
            .eq("assigned_to", user.id)
            .eq("status", "open")
            .lte("due_date", today)
            .order("due_date", { ascending: true });
        if (choresRes.error) {
            failed = true;
        } else {
            (choresRes.data || []).forEach(function (c) {
                items.push({
                    label: c.due_date < today ? "Overdue" : "Due today",
                    title: c.name,
                    detail: "Assigned to you",
                    action: "Open chores",
                    href: "chores.html",
                    tone: "clay",
                });
            });
        }

        if (items.length === 0) {
            countPill.hidden = true;
            list.innerHTML = failed
                ? "<p>Could not check your tasks. Try refreshing.</p>"
                : "<div class='all-caught-up'><span class='ico' aria-hidden='true'><svg width='22' height='22' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='m5 12 4.5 4.5L19 7'/></svg></span><p><strong>You\u2019re all caught up.</strong>Nothing needs you right now.</p></div>";
            return;
        }

        countPill.hidden = false;
        countPill.textContent = String(items.length);
        list.innerHTML = "";
        items.forEach(function (item) {
            list.innerHTML +=
                "<article class='attention-card'><span class='ico " +
                (item.tone === "green" ? "green" : "") +
                "' aria-hidden='true'><svg width='21' height='21' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='9'/><path d='m8 12 2.7 2.7L16.5 9'/></svg></span>" +
                "<div class='body'><p class='label'>" +
                escapeHtml(item.label) +
                "</p><h3>" +
                escapeHtml(item.title) +
                "</h3><p class='detail'>" +
                escapeHtml(item.detail) +
                "</p></div><a class='go' href='" +
                escapeHtml(item.href) +
                "'>" +
                escapeHtml(item.action) +
                "</a></article>";
        });
    }

    async function loadRecentActivity() {
        const box = document.getElementById("recent-activity");
        const { data, error } = await supabaseClient
            .from("history")
            .select("id, action, details, created_at, profiles(name)")
            .eq("room_id", currentRoomId)
            .order("created_at", { ascending: false })
            .limit(3);

        if (error) {
            box.innerHTML = "<p>Could not load activity. Try refreshing.</p>";
            return;
        }
        if (!data || data.length === 0) {
            box.innerHTML = "<p>No activity yet. Add an expense or a chore to get started.</p>";
            return;
        }

        const labels = {
            expense_added: "added an expense",
            chore_added: "added a chore",
            chore_completed: "completed a chore",
            roommate_joined: "joined the room",
            payment_marked_paid: "recorded a payment",
            payment_confirmed: "confirmed a payment",
            payment_declined: "declined a payment",
        };
        box.innerHTML = "";
        data.forEach(function (entry) {
            const actor = entry.profiles ? entry.profiles.name : "Someone";
            const tone = entry.action.indexOf("expense") === 0 ? "clay" : entry.action.indexOf("payment") === 0 ? "sand" : "";
            box.innerHTML +=
                "<div class='activity-row'><span class='ico " +
                tone +
                "' aria-hidden='true'><svg width='18' height='18' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'><circle cx='12' cy='12' r='9'/><path d='M12 7v5l3 2'/></svg></span><div><p class='what'>" +
                escapeHtml(actor + " " + (labels[entry.action] || entry.action.replace(/_/g, " "))) +
                "</p><p class='meta'>" +
                escapeHtml((entry.details ? entry.details + " \u00b7 " : "") + timeAgo(entry.created_at)) +
                "</p></div></div>";
        });
    }

    splitCostBtn.addEventListener("click", async function () {
        const item = document.getElementById("item").value.trim();
        const amount = getCurrencyValue(amountInput);
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
                const name = membersById[memberId] || "That roommate";
                const value = getCurrencyValue(inputs[i]);

                if (isNaN(value)) {
                    expenseErrorDiv.innerHTML = "<p>Enter a valid amount for " + escapeHtml(name) + ".</p>";
                    return;
                }
                if (value < 0) {
                    expenseErrorDiv.innerHTML = "<p>" + escapeHtml(name) + "'s amount can't be negative.</p>";
                    return;
                }
                if (value > amount) {
                    expenseErrorDiv.innerHTML =
                        "<p>" +
                        escapeHtml(name) +
                        "'s amount ($" +
                        value.toFixed(2) +
                        ") can't be more than the total expense ($" +
                        amount.toFixed(2) +
                        ").</p>";
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
            expenseErrorDiv.innerHTML = "<p>" + escapeHtml(expenseInsertError.message) + "</p>";
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
            expenseErrorDiv.innerHTML = "<p>" + escapeHtml(splitsError.message) + "</p>";
            return;
        }

        document.getElementById("item").value = "";
        amountInput.value = "";
        splitEqualRadio.checked = true;
        customSplitSection.style.display = "none";
        customSplitInputs.innerHTML = "";
        setExpenseSheet(false);

        loadBalanceSummary();
        loadAttention();
        loadRecentActivity();
    });

    // Auto-refresh: rather than requiring a manual reload to see an
    // expense or chore that someone else (or another tab) just added,
    // subscribe to the tables this page cares about and re-run the
    // relevant load functions whenever something changes.
    supabaseClient
        .channel("room-" + currentRoomId + "-dashboard")
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "expenses", filter: "room_id=eq." + currentRoomId },
            function () {
                loadBalanceSummary();
            }
        )
        .on("postgres_changes", { event: "*", schema: "public", table: "expense_splits" }, function () {
            loadBalanceSummary();
        })
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "chores", filter: "room_id=eq." + currentRoomId },
            function () {
                loadChoresPreview();
                loadAttention();
            }
        )
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "payments", filter: "room_id=eq." + currentRoomId },
            function () {
                loadBalanceSummary();
                loadAttention();
                loadRecentActivity();
            }
        )
        .subscribe();

    renderGreeting();
    await loadMembers();
    await loadBalanceSummary();
    await loadChoresPreview();
    await loadAttention();
    await loadRecentActivity();

    // "Add new" from another page lands here with ?add=expense
    if (new URLSearchParams(location.search).get("add") === "expense") {
        setExpenseSheet(true);
    }
};