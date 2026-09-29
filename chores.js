/*
Name: Naman Agrawal
This is chores.js. It loads the current room's members and open chores
from Supabase, and handles creating and completing chores — including
recurring chores that rotate between a chosen order of roommates each
time they're completed. Only the roommate a chore is currently assigned
to can mark it complete; everyone else can still see it and its status.
Also subscribes to Supabase Realtime so the chore list updates
automatically instead of requiring a manual reload.
*/
window.onload = async function () {
    const currentRoomId = localStorage.getItem("currentRoomId");
    const {
        data: { user },
    } = await supabaseClient.auth.getUser();

    let membersById = {};
    let choresById = {}; // full chore rows, keyed by id, for use in the completion handler

    const expandChoreBtn = document.getElementById("expand-chore-btn");
    const choreForm = document.getElementById("chore-form");
    const assignSelect = document.getElementById("assign-to");
    const splitChoreBtn = document.getElementById("split-chore-btn");
    const choreErrorDiv = document.getElementById("chore-error");
    const choreListDiv = document.getElementById("chore-list");
    const repeatFrequencySelect = document.getElementById("repeat-frequency");
    const rotationSection = document.getElementById("rotation-section");
    const rotationCheckboxesDiv = document.getElementById("rotation-checkboxes");

    let choreFormOpen = false;
    expandChoreBtn.addEventListener("click", function () {
        choreFormOpen = !choreFormOpen;
        choreForm.style.display = choreFormOpen ? "block" : "none";
        expandChoreBtn.innerHTML = choreFormOpen ? "- Add Chore" : "+ Add Chore";
    });

    repeatFrequencySelect.addEventListener("change", function () {
        const repeats = repeatFrequencySelect.value !== "none";
        rotationSection.style.display = repeats ? "block" : "none";
        if (!repeats) {
            assignSelect.disabled = false;
        }
        updateAssigneeFromRotation();
    });

    function getCheckedRotationIds() {
        const boxes = document.getElementsByClassName("rotation-checkbox");
        const checked = [];
        for (let i = 0; i < boxes.length; i++) {
            if (boxes[i].checked) {
                checked.push(boxes[i].value);
            }
        }
        return checked;
    }

    // When rotation checkboxes are used, the "Assign to" dropdown is
    // locked to the first person checked, so the starting assignee and
    // the rotation order can never disagree with each other.
    function updateAssigneeFromRotation() {
        if (repeatFrequencySelect.value === "none") {
            assignSelect.disabled = false;
            return;
        }
        const checked = getCheckedRotationIds();
        if (checked.length > 0) {
            assignSelect.value = checked[0];
            assignSelect.disabled = true;
        } else {
            assignSelect.disabled = false;
        }
    }

    async function loadMembers() {
        const { data, error } = await supabaseClient
            .from("room_members")
            .select("user_id, profiles(name)")
            .eq("room_id", currentRoomId)
            .eq("is_active", true);

        if (error || !data) {
            return;
        }

        assignSelect.innerHTML = "";
        rotationCheckboxesDiv.innerHTML = "";
        membersById = {};

        for (let i = 0; i < data.length; i++) {
            const name = data[i].profiles ? data[i].profiles.name : "Unknown";
            const id = data[i].user_id;
            membersById[id] = name;

            assignSelect.innerHTML += "<option value='" + id + "'>" + name + "</option>";
            rotationCheckboxesDiv.innerHTML +=
                "<label><input type='checkbox' class='rotation-checkbox' value='" +
                id +
                "'> " +
                name +
                "</label><br>";
        }

        const rotationBoxes = document.getElementsByClassName("rotation-checkbox");
        for (let i = 0; i < rotationBoxes.length; i++) {
            rotationBoxes[i].addEventListener("change", updateAssigneeFromRotation);
        }
    }

    function addInterval(dateStr, frequency) {
        const d = new Date(dateStr + "T00:00:00");
        if (frequency === "weekly") {
            d.setDate(d.getDate() + 7);
        } else if (frequency === "biweekly") {
            d.setDate(d.getDate() + 14);
        } else if (frequency === "monthly") {
            d.setMonth(d.getMonth() + 1);
        }
        return d.toISOString().split("T")[0];
    }

    // Creates the next occurrence of a recurring chore once the current
    // one is completed: advances the due date by the chore's frequency,
    // and — if it rotates between people — moves to the next person in
    // that list, wrapping back to the start. Requires the
    // rotation_user_ids / rotation_position columns from
    // schema_fixes_2.sql to exist on the chores table.
    async function createNextOccurrence(chore) {
        const nextDueDate = chore.due_date ? addInterval(chore.due_date, chore.recurrence) : null;

        let nextAssignee = chore.assigned_to;
        let nextRotationPosition = chore.rotation_position || 0;

        if (chore.rotation_user_ids && chore.rotation_user_ids.length > 0) {
            const rotation = chore.rotation_user_ids;
            const currentIndex = rotation.indexOf(chore.assigned_to);
            nextRotationPosition = (currentIndex === -1 ? 0 : currentIndex + 1) % rotation.length;
            nextAssignee = rotation[nextRotationPosition];
        }

        const { data, error } = await supabaseClient
            .from("chores")
            .insert({
                room_id: currentRoomId,
                name: chore.name,
                assigned_to: nextAssignee,
                due_date: nextDueDate,
                recurrence: chore.recurrence,
                rotation_user_ids: chore.rotation_user_ids,
                rotation_position: nextRotationPosition,
                created_by: user.id,
            })
            .select()
            .single();

        if (error || !data) {
            return;
        }

        await supabaseClient.from("history").insert({
            room_id: currentRoomId,
            actor_id: user.id,
            action: "chore_added",
            details: chore.name + " - automatically reassigned to " + (membersById[nextAssignee] || "Unknown"),
            related_type: "chore",
            related_id: data.id,
        });
    }

    async function loadChores() {
        const { data, error } = await supabaseClient
            .from("chores")
            .select("id, name, assigned_to, due_date, recurrence, rotation_user_ids, rotation_position")
            .eq("room_id", currentRoomId)
            .eq("status", "open")
            .order("due_date", { ascending: true });

        if (error) {
            choreListDiv.innerHTML = "<p>Something went wrong loading chores. Try refreshing.</p>";
            return;
        }

        if (!data || data.length === 0) {
            choreListDiv.innerHTML = "<p>No chores added</p>";
            return;
        }

        choresById = {};
        choreListDiv.innerHTML = "";
        for (let i = 0; i < data.length; i++) {
            const chore = data[i];
            choresById[chore.id] = chore;
            const assigneeName = membersById[chore.assigned_to] || "Unassigned";
            const isMine = chore.assigned_to === user.id;

            choreListDiv.innerHTML +=
                "<div class='chore-entry'>" +
                "<h3>" +
                chore.name +
                (chore.recurrence && chore.recurrence !== "none" ? " (repeats " + chore.recurrence + ")" : "") +
                "</h3>" +
                "<p>Assigned to: " +
                assigneeName +
                "</p>" +
                "<p>Due: " +
                (chore.due_date || "No due date") +
                "</p>" +
                (isMine
                    ? "<button class='complete-chore-btn' data-id='" + chore.id + "'>Complete</button>"
                    : "<p><em>Only " + assigneeName + " can mark this complete.</em></p>") +
                "</div>";
        }

        const completeButtons = document.getElementsByClassName("complete-chore-btn");
        for (let i = 0; i < completeButtons.length; i++) {
            completeButtons[i].addEventListener("click", async function () {
                const id = this.getAttribute("data-id");
                const chore = choresById[id];

                await supabaseClient
                    .from("chores")
                    .update({
                        status: "completed",
                        completed_at: new Date().toISOString(),
                        completed_by: user.id,
                    })
                    .eq("id", id);

                await supabaseClient.from("history").insert({
                    room_id: currentRoomId,
                    actor_id: user.id,
                    action: "chore_completed",
                    details: "Chore marked complete",
                    related_type: "chore",
                    related_id: id,
                });

                if (chore && chore.recurrence && chore.recurrence !== "none") {
                    await createNextOccurrence(chore);
                }

                loadChores();
            });
        }
    }

    splitChoreBtn.addEventListener("click", async function () {
        const choreName = document.getElementById("task").value.trim();
        const dueDate = document.getElementById("deadline").value;
        const assignedTo = assignSelect.value;
        const recurrence = repeatFrequencySelect.value;
        const rotationIds = getCheckedRotationIds();

        choreErrorDiv.innerHTML = "";

        if (choreName === "" || dueDate === "" || !assignedTo) {
            choreErrorDiv.innerHTML = "<p>You need a chore name, due date, and an assigned roommate.</p>";
            return;
        }

        splitChoreBtn.disabled = true;

        const { data, error } = await supabaseClient
            .from("chores")
            .insert({
                room_id: currentRoomId,
                name: choreName,
                assigned_to: assignedTo,
                due_date: dueDate,
                recurrence: recurrence,
                rotation_user_ids: rotationIds.length > 0 ? rotationIds : null,
                rotation_position: 0,
                created_by: user.id,
            })
            .select()
            .single();

        splitChoreBtn.disabled = false;

        if (error) {
            choreErrorDiv.innerHTML = "<p>" + error.message + "</p>";
            return;
        }

        await supabaseClient.from("history").insert({
            room_id: currentRoomId,
            actor_id: user.id,
            action: "chore_added",
            details: choreName + " - Assigned to " + (membersById[assignedTo] || "Unknown"),
            related_type: "chore",
            related_id: data.id,
        });

        document.getElementById("task").value = "";
        document.getElementById("deadline").value = "";
        repeatFrequencySelect.value = "none";
        rotationSection.style.display = "none";
        assignSelect.disabled = false;
        const rotationBoxes = document.getElementsByClassName("rotation-checkbox");
        for (let i = 0; i < rotationBoxes.length; i++) {
            rotationBoxes[i].checked = false;
        }
        choreForm.style.display = "none";
        choreFormOpen = false;
        expandChoreBtn.innerHTML = "+ Add Chore";

        loadChores();
    });

    // Auto-refresh: pick up chores added or completed by other roommates
    // (or another tab) without needing a manual reload. This MUST live
    // inside window.onload — currentRoomId only exists in this scope.
    supabaseClient
        .channel("room-" + currentRoomId + "-chores")
        .on(
            "postgres_changes",
            { event: "*", schema: "public", table: "chores", filter: "room_id=eq." + currentRoomId },
            function () {
                loadChores();
            }
        )
        .subscribe();

    await loadMembers();
    await loadChores();
};