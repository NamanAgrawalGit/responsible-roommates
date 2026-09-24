/*
Name: Naman Agrawal
This is chores.js. It loads the current room's members and open chores
from Supabase, and handles creating and completing chores.
Replaces the old localStorage-based version.
*/
window.onload = async function () {
    const currentRoomId = localStorage.getItem("currentRoomId");
    const {
        data: { user },
    } = await supabaseClient.auth.getUser();

    let membersById = {};

    const expandChoreBtn = document.getElementById("expand-chore-btn");
    const choreForm = document.getElementById("chore-form");
    const assignSelect = document.getElementById("assign-to");
    const splitChoreBtn = document.getElementById("split-chore-btn");
    const choreErrorDiv = document.getElementById("chore-error");
    const choreListDiv = document.getElementById("chore-list");

    let choreFormOpen = false;
    expandChoreBtn.addEventListener("click", function () {
        choreFormOpen = !choreFormOpen;
        choreForm.style.display = choreFormOpen ? "block" : "none";
        expandChoreBtn.innerHTML = choreFormOpen ? "- Add Chore" : "+ Add Chore";
    });

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
            const name = data[i].profiles ? data[i].profiles.name : "Unknown";
            membersById[data[i].user_id] = name;
            assignSelect.innerHTML += "<option value='" + data[i].user_id + "'>" + name + "</option>";
        }
    }

    async function loadChores() {
        const { data, error } = await supabaseClient
            .from("chores")
            .select("id, name, assigned_to, due_date")
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

        choreListDiv.innerHTML = "";
        for (let i = 0; i < data.length; i++) {
            const chore = data[i];
            choreListDiv.innerHTML +=
                "<div class='chore-entry'>" +
                "<h3>" +
                chore.name +
                "</h3>" +
                "<p>Assigned to: " +
                (membersById[chore.assigned_to] || "Unassigned") +
                "</p>" +
                "<p>Due: " +
                (chore.due_date || "No due date") +
                "</p>" +
                "<button class='complete-chore-btn' data-id='" +
                chore.id +
                "'>Complete</button>" +
                "</div>";
        }

        const completeButtons = document.getElementsByClassName("complete-chore-btn");
        for (let i = 0; i < completeButtons.length; i++) {
            completeButtons[i].addEventListener("click", async function () {
                const id = this.getAttribute("data-id");

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

                loadChores();
            });
        }
    }

    splitChoreBtn.addEventListener("click", async function () {
        const choreName = document.getElementById("task").value.trim();
        const dueDate = document.getElementById("deadline").value;
        const assignedTo = assignSelect.value;

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
        choreForm.style.display = "none";
        choreFormOpen = false;
        expandChoreBtn.innerHTML = "+ Add Chore";

        loadChores();
    });

    await loadMembers();
    await loadChores();
};
