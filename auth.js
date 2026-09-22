/*
Name: Naman Agrawal
This is auth.js. It handles account creation and login for the
Responsible Roommates app using Supabase Auth.
*/
window.onload = async function () {
    // If already logged in, skip straight to the app.
    const {
        data: { session },
    } = await supabaseClient.auth.getSession();
    if (session) {
        window.location.href = "index.html";
        return;
    }

    let isSignUpMode = false;

    const authHeading = document.getElementById("auth-heading");
    const nameField = document.getElementById("auth-name-field");
    const nameInput = document.getElementById("auth-name");
    const emailInput = document.getElementById("auth-email");
    const passwordInput = document.getElementById("auth-password");
    const submitBtn = document.getElementById("auth-submit-btn");
    const errorDiv = document.getElementById("auth-error");
    const toggleLink = document.getElementById("auth-toggle-link");
    const toggleQuestion = document.getElementById("auth-toggle-question");
    const googleBtn = document.getElementById("google-auth-btn");

    nameField.style.display = "none";

    toggleLink.addEventListener("click", function (e) {
        e.preventDefault();
        isSignUpMode = !isSignUpMode;
        errorDiv.innerHTML = "";

        if (isSignUpMode) {
            authHeading.innerHTML = "Sign Up";
            submitBtn.innerHTML = "Sign Up";
            nameField.style.display = "block";
            toggleQuestion.innerHTML = "Already have an account?";
            toggleLink.innerHTML = "Log in";
        } else {
            authHeading.innerHTML = "Log In";
            submitBtn.innerHTML = "Log In";
            nameField.style.display = "none";
            toggleQuestion.innerHTML = "Don't have an account?";
            toggleLink.innerHTML = "Sign up";
        }
    });

    submitBtn.addEventListener("click", async function () {
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        const name = nameInput.value.trim();

        errorDiv.innerHTML = "";

        if (email === "" || password === "") {
            errorDiv.innerHTML = "<p>Email and password are required.</p>";
            return;
        }

        if (isSignUpMode && name === "") {
            errorDiv.innerHTML = "<p>Please enter your name.</p>";
            return;
        }

        submitBtn.disabled = true;

        if (isSignUpMode) {
            const { data, error } = await supabaseClient.auth.signUp({
                email: email,
                password: password,
                options: {
                    data: { name: name },
                },
            });

            submitBtn.disabled = false;

            if (error) {
                errorDiv.innerHTML = "<p>" + error.message + "</p>";
                return;
            }

            // If email confirmation is required, there won't be a session yet.
            if (!data.session) {
                errorDiv.innerHTML =
                    "<p>Account created! Check your email to confirm, then log in.</p>";
                return;
            }

            window.location.href = "index.html";
        } else {
            const { error } = await supabaseClient.auth.signInWithPassword({
                email: email,
                password: password,
            });

            submitBtn.disabled = false;

            if (error) {
                errorDiv.innerHTML = "<p>" + error.message + "</p>";
                return;
            }

            window.location.href = "index.html";
        }
    });

    googleBtn.addEventListener("click", async function () {
        await supabaseClient.auth.signInWithOAuth({
            provider: "google",
            options: {
                redirectTo: window.location.origin + window.location.pathname.replace("auth.html", "index.html"),
            },
        });
    });
};
