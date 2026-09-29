/*
Name: Naman Agrawal
This is chores.js. It loads the current room's members and open chores
from Supabase, and handles creating and completing chores.

Supports:
- One-time chores
- Weekly recurring chores
- Biweekly recurring chores
- Monthly recurring chores
- Recurring chores without rotation
- Recurring chores with roommate rotation
*/

window.onload = async function () {
    const currentRoomId = localStorage.getItem("currentRoomId");

    const {
        data: { user },
    } = await supabaseClient.auth.getUser();

    let membersById = {};
    let rotationOrder = [];

    const expandChoreBtn = document.getElementById("expand-chore-btn");
    const choreForm = document.getElementById("chore-form");
    const assignSelect = document.getElementById("assign-to");
    const splitChoreBtn = document.getElementById("split-chore-btn");
    const choreErrorDiv = document.getElementById("chore-error");
    const choreListDiv = document.getElementById("chore-list");

    // Recurrence and rotation elements
    const repeatFrequency = document.getElementById("repeat-frequency");
    const rotationSection = document.getElementById("rotation-section");
    const rotationCheckboxes = document.getElementById("rotation-checkboxes");

    let choreFormOpen = false;

    /*
    ============================================================
    ADD CHORE FORM
    ============================================================
    */

    expandChoreBtn.addEventListener("click", function () {
        choreFormOpen = !choreFormOpen;
        choreForm.style.display = choreFormOpen ? "block" : "none";
        expandChoreBtn.innerHTML = choreFormOpen
            ? "- Add Chore"
            : "+ Add Chore";
    });

    /*
    ============================================================
    ROTATION UI
    ============================================================
    */

    /*
    Shows or hides the rotation section depending on whether
    the chore is recurring.
    */
    repeatFrequency.addEventListener("change", function () {
        if (repeatFrequency.value === "none") {
            rotationSection.classList.add("hidden");

            // Clear any previous rotation selection
            rotationOrder = [];

            const checkboxes =
                rotationCheckboxes.querySelectorAll(
                    "input[type='checkbox']"
                );

            for (let i = 0; i < checkboxes.length; i++) {
                checkboxes[i].checked = false;
            }
        } else {
            rotationSection.classList.remove("hidden");
        }
    });

    /*
    Creates the roommate checkboxes used for rotation.
    */
    function renderRotationCheckboxes(data) {
        rotationCheckboxes.innerHTML = "";

        for (let i = 0; i < data.length; i++) {
            const member = data[i];

            const label = document.createElement("label");
            label.className = "rotation-member";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = member.user_id;

            checkbox.addEventListener(
                "change",
                handleRotationChange
            );

            label.appendChild(checkbox);

            const name = member.profiles
                ? member.profiles.name
                : "Unknown";

            label.appendChild(
                document.createTextNode(" " + name)
            );

            rotationCheckboxes.appendChild(label);
            rotationCheckboxes.appendChild(
                document.createElement("br")
            );
        }
    }

    /*
    Keeps track of the order in which roommates are selected.

    Example:
    First click  -> Naman
    Second click -> Diego
    Third click  -> Alex

    rotationOrder becomes:
    [Naman, Diego, Alex]
    */
    function handleRotationChange(event) {
        const userId = event.target.value;

        if (event.target.checked) {
            rotationOrder.push(userId);
        } else {
            rotationOrder = rotationOrder.filter(function (id) {
                return id !== userId;
            });
        }
    }

    /*
    ============================================================
    LOAD ROOM MEMBERS
    ============================================================
    */

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

        for (let i = 0; i < data.length; i++) {
            const name = data[i].profiles
                ? data[i].profiles.name
                : "Unknown";

            membersById[data[i].user_id] = name;

            assignSelect.innerHTML +=
                "<option value='" +
                data[i].user_id +
                "'>" +
                name +
                "</option>";
        }

        // Create the rotation checkboxes
        renderRotationCheckboxes(data);
    }

    /*
    ============================================================
    CALCULATE NEXT DUE DATE
    ============================================================
    */

    function getNextDueDate(dateString, recurrence) {
        const date = new Date(dateString + "T00:00:00");

        if (recurrence === "weekly") {
            date.setDate(date.getDate() + 7);
        } else if (recurrence === "biweekly") {
            date.setDate(date.getDate() + 14);
        } else if (recurrence === "monthly") {
            date.setMonth(date.getMonth() + 1);
        }

        return date.toISOString().split("T")[0];
    }

    /*
    ============================================================
    DETERMINE NEXT ROTATION ASSIGNEE
    ============================================================
    */

    function getNextAssignee(chore) {
        const savedRotationOrder =
            chore.rotation_order || [];

        /*
        If nobody was selected for rotation,
        keep assigning the chore to the same person.
        */
        if (savedRotationOrder.length === 0) {
            return {
                assignedTo: chore.assigned_to,
                rotationIndex: chore.rotation_index || 0,
            };
        }

        const currentIndex =
            chore.rotation_index || 0;

        const nextIndex =
            (currentIndex + 1) %
            savedRotationOrder.length;

        return {
            assignedTo: savedRotationOrder[nextIndex],
            rotationIndex: nextIndex,
        };
    }

    /*
    ============================================================
    COMPLETE ONE-TIME CHORE
    ============================================================
    */

    async function completeOneTimeChore(chore) {
        const { error } = await supabaseClient
            .from("chores")
            .update({
                status: "completed",
                completed_at: new Date().toISOString(),
                completed_by: user.id,
            })
            .eq("id", chore.id);

        if (error) {
            console.error(
                "Error completing chore:",
                error
            );

            choreErrorDiv.innerHTML =
                "<p>Something went wrong completing the chore. Please try again.</p>";

            return;
        }

        await supabaseClient.from("history").insert({
            room_id: currentRoomId,
            actor_id: user.id,
            action: "chore_completed",
            details: chore.name + " marked complete",
            related_type: "chore",
            related_id: chore.id,
        });

        await loadChores();
    }

    /*
    ============================================================
    COMPLETE RECURRING CHORE
    ============================================================
    */

    async function completeRecurringChore(chore) {
        /*
        Calculate the next due date based on the current
        due date rather than today's date.

        Example:
        Due Sept 30
        Completed Oct 2
        Weekly

        Next due date = Oct 7
        */
        const nextDueDate = getNextDueDate(
            chore.due_date,
            chore.recurrence
        );

        /*
        Determine who should receive the next occurrence.
        */
        const nextAssignment =
            getNextAssignee(chore);

        /*
        Keep the same chore open, but move it to the
        next occurrence.
        */
        const { error } = await supabaseClient
            .from("chores")
            .update({
                status: "open",
                due_date: nextDueDate,
                assigned_to: nextAssignment.assignedTo,
                rotation_index:
                    nextAssignment.rotationIndex,
                completed_at: new Date().toISOString(),
                completed_by: user.id,
            })
            .eq("id", chore.id);

        if (error) {
            console.error(
                "Error completing recurring chore:",
                error
            );

            choreErrorDiv.innerHTML =
                "<p>Something went wrong completing the chore. Please try again.</p>";

            return;
        }

        /*
        Record the completion in history.

        The chore itself remains open because it now
        represents the next occurrence.
        */
        await supabaseClient.from("history").insert({
            room_id: currentRoomId,
            actor_id: user.id,
            action: "chore_completed",
            details:
                chore.name +
                " completed. Next due " +
                nextDueDate +
                " and assigned to " +
                (membersById[
                    nextAssignment.assignedTo
                ] || "Unknown"),
            related_type: "chore",
            related_id: chore.id,
        });

        await loadChores();
    }

    /*
    ============================================================
    COMPLETE CHORE
    ============================================================
    */

    async function completeChore(id) {
        /*
        Retrieve the full chore first so we know whether
        it is recurring and whether it has a rotation.
        */
        const { data: chore, error } =
            await supabaseClient
                .from("chores")
                .select("*")
                .eq("id", id)
                .single();

        if (error || !chore) {
            console.error(
                "Error loading chore:",
                error
            );

            choreErrorDiv.innerHTML =
                "<p>Something went wrong loading the chore. Please try again.</p>";

            return;
        }

        /*
        One-time chore:
        Mark it permanently completed.

        Recurring chore:
        Move it to its next occurrence.
        */
        if (
            !chore.recurrence ||
            chore.recurrence === "none"
        ) {
            await completeOneTimeChore(chore);
        } else {
            await completeRecurringChore(chore);
        }
    }

    /*
    ============================================================
    LOAD CHORES
    ============================================================
    */

    async function loadChores() {
        const { data, error } = await supabaseClient
            .from("chores")
            .select(
                "id, name, assigned_to, due_date, recurrence, rotation_order, rotation_index"
            )
            .eq("room_id", currentRoomId)
            .eq("status", "open")
            .order("due_date", { ascending: true });

        if (error) {
            console.error(
                "Error loading chores:",
                error
            );

            choreListDiv.innerHTML =
                "<p>Something went wrong loading chores. Try refreshing.</p>";

            return;
        }

        if (!data || data.length === 0) {
            choreListDiv.innerHTML =
                "<p>No chores added</p>";

            return;
        }

        choreListDiv.innerHTML = "";

        for (let i = 0; i < data.length; i++) {
            const chore = data[i];

            let recurrenceText = "";

            if (chore.recurrence === "weekly") {
                recurrenceText = "<p>Repeats: Every week</p>";
            } else if (
                chore.recurrence === "biweekly"
            ) {
                recurrenceText =
                    "<p>Repeats: Every 2 weeks</p>";
            } else if (
                chore.recurrence === "monthly"
            ) {
                recurrenceText =
                    "<p>Repeats: Every month</p>";
            }

            choreListDiv.innerHTML +=
                "<div class='chore-entry'>" +
                "<h3>" +
                chore.name +
                "</h3>" +
                "<p>Assigned to: " +
                (membersById[chore.assigned_to] ||
                    "Unassigned") +
                "</p>" +
                "<p>Due: " +
                (chore.due_date ||
                    "No due date") +
                "</p>" +
                recurrenceText +
                "<button class='complete-chore-btn' data-id='" +
                chore.id +
                "'>Complete</button>" +
                "</div>";
        }

        /*
        Add click events to all Complete buttons.
        */
        const completeButtons =
            document.getElementsByClassName(
                "complete-chore-btn"
            );

        for (
            let i = 0;
            i < completeButtons.length;
            i++
        ) {
            completeButtons[i].addEventListener(
                "click",
                async function () {
                    const id =
                        this.getAttribute(
                            "data-id"
                        );

                    /*
                    Prevent multiple clicks while
                    the completion is processing.
                    */
                    this.disabled = true;

                    await completeChore(id);
                }
            );
        }
    }

    /*
    ============================================================
    CREATE CHORE
    ============================================================
    */

    splitChoreBtn.addEventListener(
        "click",
        async function () {
            const choreName =
                document
                    .getElementById("task")
                    .value.trim();

            const dueDate =
                document.getElementById(
                    "deadline"
                ).value;

            const assignedTo =
                assignSelect.value;

            const recurrence =
                repeatFrequency.value;

            choreErrorDiv.innerHTML = "";

            /*
            Basic validation
            */
            if (
                choreName === "" ||
                dueDate === "" ||
                !assignedTo
            ) {
                choreErrorDiv.innerHTML =
                    "<p>You need a chore name, due date, and an assigned roommate.</p>";

                return;
            }

            /*
            If this is a recurring chore, copy the
            rotation order selected by the user.
            */
            let choreRotationOrder = [];
            let initialAssignee = assignedTo;

            if (recurrence !== "none") {
                choreRotationOrder = [
                    ...rotationOrder,
                ];

                /*
                If roommates were selected for rotation,
                the first selected roommate becomes the
                first assignee.
                */
                if (
                    choreRotationOrder.length > 0
                ) {
                    initialAssignee =
                        choreRotationOrder[0];
                }
            }

            splitChoreBtn.disabled = true;

            const { data, error } =
                await supabaseClient
                    .from("chores")
                    .insert({
                        room_id:
                            currentRoomId,
                        name: choreName,
                        assigned_to:
                            initialAssignee,
                        due_date: dueDate,
                        recurrence:
                            recurrence,
                        rotation_order:
                            choreRotationOrder,
                        rotation_index: 0,
                        created_by: user.id,
                    })
                    .select()
                    .single();

            splitChoreBtn.disabled = false;

            if (error) {
                console.error(
                    "Error creating chore:",
                    error
                );

                choreErrorDiv.innerHTML =
                    "<p>" +
                    error.message +
                    "</p>";

                return;
            }

            /*
            Record the chore creation in history.
            */
            await supabaseClient
                .from("history")
                .insert({
                    room_id:
                        currentRoomId,
                    actor_id: user.id,
                    action: "chore_added",
                    details:
                        choreName +
                        " - Assigned to " +
                        (membersById[
                            initialAssignee
                        ] ||
                            "Unknown"),
                    related_type: "chore",
                    related_id: data.id,
                });

            /*
            Reset the form.
            */
            document.getElementById(
                "task"
            ).value = "";

            document.getElementById(
                "deadline"
            ).value = "";

            /*
            Reset recurrence.
            */
            repeatFrequency.value = "none";

            /*
            Reset rotation.
            */
            rotationOrder = [];

            const checkboxes =
                rotationCheckboxes.querySelectorAll(
                    "input[type='checkbox']"
                );

            for (
                let i = 0;
                i < checkboxes.length;
                i++
            ) {
                checkboxes[i].checked = false;
            }

            rotationSection.classList.add(
                "hidden"
            );

            /*
            Close the form.
            */
            choreForm.style.display = "none";
            choreFormOpen = false;
            expandChoreBtn.innerHTML =
                "+ Add Chore";

            await loadChores();
        }
    );

    /*
    ============================================================
    INITIAL LOAD
    ============================================================
    */

    await loadMembers();
    await loadChores();

    /*
    ============================================================
    REAL-TIME UPDATES
    ============================================================
    
    Re-run loadChores() whenever anyone in the room
    adds, edits, or completes a chore.
    */

    supabaseClient
        .channel(
            "room-" +
                currentRoomId +
                "-chores"
        )
        .on(
            "postgres_changes",
            {
                event: "*",
                schema: "public",
                table: "chores",
                filter:
                    "room_id=eq." +
                    currentRoomId,
            },
            function () {
                loadChores();
            }
        )
        .subscribe();
};