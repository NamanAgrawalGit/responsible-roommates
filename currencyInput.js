/*
Name: Naman Agrawal
currencyInput.js — shared helper for dollar-amount inputs. Shows a live
"$" prefix while typing, and locks the value to two decimal places on
blur (e.g. "$50.00"). Loaded on any page with a dollar-amount field,
before the page's own script.
*/
function attachCurrencyInput(inputEl) {
    inputEl.setAttribute("type", "text");
    inputEl.setAttribute("inputmode", "decimal");

    function rawDigitsAndDot(value) {
        let cleaned = value.replace(/[^0-9.]/g, "");
        const firstDot = cleaned.indexOf(".");
        if (firstDot !== -1) {
            cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
        }
        return cleaned;
    }

    inputEl.addEventListener("focus", function () {
        // Drop the $ while editing so it doesn't get in the way of typing.
        inputEl.value = rawDigitsAndDot(inputEl.value);
    });

    inputEl.addEventListener("input", function () {
        const cleaned = rawDigitsAndDot(inputEl.value);
        inputEl.value = cleaned === "" ? "" : "$" + cleaned;
    });

    inputEl.addEventListener("blur", function () {
        const cleaned = rawDigitsAndDot(inputEl.value);
        const num = parseFloat(cleaned);
        inputEl.value = isNaN(num) ? "" : "$" + num.toFixed(2);
    });
}

// Reads the numeric value out of a field that has attachCurrencyInput
// applied, regardless of whether it currently shows a "$" or not.
function getCurrencyValue(inputEl) {
    const cleaned = inputEl.value.replace(/[^0-9.]/g, "");
    return parseFloat(cleaned);
}