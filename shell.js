/*
Name: Naman Agrawal
This is shell.js. It gives every signed-in page the redesigned app shell:
a left sidebar on desktop, a bottom navigation bar and "More" sheet on
phones and tablets, and an "Add new" action. It builds these from the links
already in each page's <header>, so the nav is defined in one place.

It does not touch data. "Switch Room" and "Log Out" are not re-implemented:
the new buttons simply click the original #switch-room-btn / #logout-btn
links, which authGuard.js wires up. Two small helpers also live here because
several pages share them: page tabs (data-tabs) and list search (data-search).
*/
(function () {
    const SVG_OPEN =
        '<svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">';
    const ICONS = {
        home: '<path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9M9 20v-6h6v6"/>',
        receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z"/><path d="M9 8h6M9 12h6"/>',
        check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 2.7 2.7L16.5 9"/>',
        activity: '<path d="M4 19v-6M10 19V5M16 19v-9M22 19V8"/><circle cx="4" cy="9" r="2"/>',
        more: '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>',
        plus: '<path d="M12 5v14M5 12h14"/>',
        help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .9-1 1.7M12 17h.01"/>',
        swap: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
        out: '<path d="M10 4H5v16h5M15 8l4 4-4 4M19 12H9"/>',
    };

    function icon(name) {
        return SVG_OPEN + ICONS[name] + "</svg>";
    }

    const PRIMARY = [
        { href: "index.html", label: "Home", icon: "home" },
        { href: "balances.html", label: "Expenses", icon: "receipt" },
        { href: "chores.html", label: "Chores", icon: "check" },
        { href: "history.html", label: "Activity", icon: "activity" },
    ];

    const here = (location.pathname.split("/").pop() || "index.html").toLowerCase();

    function proxy(id) {
        const target = document.getElementById(id);
        if (target) {
            target.click();
        }
    }

    function el(tag, className, html) {
        const node = document.createElement(tag);
        if (className) {
            node.className = className;
        }
        if (html) {
            node.innerHTML = html; // static markup only; no user text is passed here
        }
        return node;
    }

    function linkItem(item) {
        const a = el("a", "shell-link", icon(item.icon) + "<span>" + item.label + "</span>");
        a.href = item.href;
        if (item.href === here) {
            a.setAttribute("aria-current", "page");
        }
        return a;
    }

    function buttonItem(label, iconName, onClick) {
        const b = el("button", "shell-link", icon(iconName) + "<span>" + label + "</span>");
        b.type = "button";
        b.addEventListener("click", onClick);
        return b;
    }

    // Opens the page's own "add" form when it has one; otherwise goes to it.
    function addNew(e) {
        const expenseBtn = document.getElementById("split-expense-expand");
        const choreBtn = document.getElementById("expand-chore-btn");
        if (here === "index.html" && expenseBtn) {
            e.preventDefault();
            if (!document.body.classList.contains("sheet-open")) {
                expenseBtn.click();
            }
        } else if (here === "chores.html" && choreBtn) {
            e.preventDefault();
            choreBtn.click();
            const form = document.getElementById("chore-form");
            if (form && form.scrollIntoView) {
                form.scrollIntoView({ behavior: "smooth", block: "start" });
            }
        }
    }

    function buildShell() {
        const header = document.querySelector("header");
        if (!header || !header.querySelector("a.bell-link") || !header.querySelector('nav a[href="balances.html"]')) {
            return; // login / room-select keep the simple header
        }
        document.body.classList.add("has-shell");

        const addHref = here === "chores.html" ? "chores.html" : "index.html";

        // ---- Desktop sidebar ----
        const rail = el("aside", "side-rail");
        rail.setAttribute("aria-label", "Main");
        const brand = el("a", "brand", '<img src="logo.svg" alt="" width="40" height="40"><span>Responsible<br>Roommates</span>');
        brand.href = "index.html";
        const add = el("a", "add-new", icon("plus") + "Add new");
        add.href = addHref;
        add.addEventListener("click", addNew);
        const nav = el("nav");
        nav.setAttribute("aria-label", "Primary");
        PRIMARY.forEach(function (item) {
            nav.appendChild(linkItem(item));
        });
        const secondary = el("div", "rail-secondary");
        secondary.appendChild(linkItem({ href: "help.html", label: "Help", icon: "help" }));
        secondary.appendChild(buttonItem("Switch room", "swap", function () { proxy("switch-room-btn"); }));
        secondary.appendChild(buttonItem("Log out", "out", function () { proxy("logout-btn"); }));
        rail.append(brand, add, nav, secondary);
        document.body.appendChild(rail);

        // ---- Phone / tablet bottom bar ----
        const bottom = el("nav", "bottom-nav");
        bottom.setAttribute("aria-label", "Primary");
        PRIMARY.forEach(function (item) {
            bottom.appendChild(linkItem(item));
        });
        const moreBtn = buttonItem("More", "more", openMore);
        moreBtn.setAttribute("aria-haspopup", "dialog");
        if (here === "help.html") {
            moreBtn.setAttribute("aria-current", "page");
        }
        bottom.appendChild(moreBtn);
        document.body.appendChild(bottom);

        // Floating add button (only where the page has something to add)
        if (here === "index.html" || here === "chores.html") {
            const fab = el("a", "fab", icon("plus"));
            fab.href = addHref;
            fab.setAttribute("aria-label", here === "chores.html" ? "Add chore" : "Add expense");
            fab.addEventListener("click", addNew);
            document.body.appendChild(fab);
        }

        // ---- More sheet ----
        const backdrop = el("div", "more-sheet-backdrop");
        const sheet = el("div", "more-sheet");
        sheet.setAttribute("role", "dialog");
        sheet.setAttribute("aria-modal", "true");
        sheet.setAttribute("aria-label", "More");
        const title = el("h2");
        title.textContent = "More";
        const who = el("p", "who");
        sheet.append(title, who);
        sheet.appendChild(linkItem({ href: "help.html", label: "Help", icon: "help" }));
        sheet.appendChild(buttonItem("Switch room", "swap", function () { closeMore(); proxy("switch-room-btn"); }));
        sheet.appendChild(buttonItem("Log out", "out", function () { closeMore(); proxy("logout-btn"); }));
        document.body.append(backdrop, sheet);

        function openMore() {
            backdrop.classList.add("open");
            sheet.classList.add("open");
            const first = sheet.querySelector("a, button");
            if (first) {
                first.focus();
            }
        }
        function closeMore() {
            backdrop.classList.remove("open");
            sheet.classList.remove("open");
        }
        backdrop.addEventListener("click", closeMore);
        document.addEventListener("keydown", function (e) {
            if (e.key === "Escape") {
                closeMore();
            }
        });

        if (typeof supabaseClient !== "undefined") {
            supabaseClient.auth.getSession().then(function (r) {
                const s = r && r.data && r.data.session;
                if (s) {
                    const m = s.user.user_metadata || {};
                    who.textContent = "Signed in as " + (m.name || m.full_name || s.user.email);
                }
            });
        }

        // The bell link in the top bar highlights on the notifications page
        const bell = header.querySelector("a.bell-link");
        if (bell && here === "notifications.html") {
            bell.classList.add("active");
        }
    }

    // ---- Page tabs: <div class="page-tabs" data-tabs> with buttons data-target="section-id" ----
    function initTabs() {
        const bars = document.querySelectorAll("[data-tabs]");
        bars.forEach(function (bar) {
            const buttons = Array.prototype.slice.call(bar.querySelectorAll("button[data-target]"));
            function show(targetId) {
                buttons.forEach(function (b) {
                    const on = b.dataset.target === targetId;
                    b.setAttribute("aria-selected", on ? "true" : "false");
                    const section = document.getElementById(b.dataset.target);
                    if (section) {
                        section.classList.toggle("tab-hidden", !on);
                    }
                });
            }
            buttons.forEach(function (b) {
                b.addEventListener("click", function () {
                    show(b.dataset.target);
                    history.replaceState(null, "", "#" + b.dataset.target);
                });
            });
            const wanted = location.hash.replace("#", "");
            const valid = buttons.some(function (b) { return b.dataset.target === wanted; });
            show(valid ? wanted : buttons[0].dataset.target);
        });
    }

    // ---- List search: <input data-search="#list-id" data-search-item=".item-class"> ----
    // Hides rows whose text does not match. Works on whatever the page has rendered.
    function initSearch() {
        document.querySelectorAll("input[data-search]").forEach(function (input) {
            function apply() {
                const list = document.querySelector(input.dataset.search);
                if (!list) {
                    return;
                }
                const term = input.value.trim().toLowerCase();
                list.querySelectorAll(input.dataset.searchItem).forEach(function (row) {
                    row.hidden = term !== "" && row.textContent.toLowerCase().indexOf(term) === -1;
                });
            }
            input.addEventListener("input", apply);
        });
    }

    function init() {
        buildShell();
        initTabs();
        initSearch();
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", init);
    } else {
        init();
    }
})();
