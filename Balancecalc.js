/*
Name: Naman Agrawal
This is balanceCalc.js. It holds the ONE shared calculation of who owes
whom in a room, so the dashboard (main.js) and the Balances page
(balances.js) can never disagree again.

Balances are pairwise and NET: what you owe Alex and what Alex owes you
cancel out into a single number per person. All math is done in whole
cents to avoid floating-point leftovers like 0.0000000001.

  loadNetBalances(roomId, userId) -> { netCents, error }
      netCents[otherUserId] > 0  means that person owes the current user
      netCents[otherUserId] < 0  means the current user owes that person

  summarizeBalances(netCents) -> {
      owes:   [{ id, amount }],   // people you owe (amount in dollars, > 0)
      owed:   [{ id, amount }],   // people who owe you
      totalOwed, totalOwedToYou, netTotal,   // dollars
      settled                                // true when every balance is 0
  }
*/
async function loadNetBalances(roomId, userId) {
    const netCents = {};

    function add(otherId, cents) {
        netCents[otherId] = (netCents[otherId] || 0) + cents;
    }

    const { data: expenses, error: expensesError } = await supabaseClient
        .from("expenses")
        .select("id, paid_by, expense_splits(user_id, amount_owed, payment_status)")
        .eq("room_id", roomId);

    if (expensesError) {
        console.error("Could not load expenses for balances:", expensesError);
        return { netCents: {}, error: expensesError };
    }

    for (let i = 0; i < expenses.length; i++) {
        const expense = expenses[i];
        const payer = expense.paid_by;
        const splits = expense.expense_splits || [];

        for (let j = 0; j < splits.length; j++) {
            const split = splits[j];

            if (split.payment_status === "paid" || split.user_id === payer) {
                continue;
            }

            const cents = Math.round(Number(split.amount_owed) * 100);

            if (split.user_id === userId) {
                add(payer, -cents);
            } else if (payer === userId) {
                add(split.user_id, cents);
            }
        }
    }

    const { data: payments, error: paymentsError } = await supabaseClient
        .from("payments")
        .select("payer_id, recipient_id, amount")
        .eq("room_id", roomId)
        .eq("status", "confirmed");

    if (paymentsError) {
        console.error("Could not load confirmed payments:", paymentsError);
        return { netCents: {}, error: paymentsError };
    }

    for (let i = 0; i < payments.length; i++) {
        const payment = payments[i];
        const cents = Math.round(Number(payment.amount) * 100);

        if (payment.payer_id === userId) {
            add(payment.recipient_id, cents);
        } else if (payment.recipient_id === userId) {
            add(payment.payer_id, -cents);
        }
    }

    return { netCents: netCents, error: null };
}

function summarizeBalances(netCents) {
    const owes = [];
    const owed = [];
    let owedCents = 0;
    let owedToYouCents = 0;

    for (const otherId in netCents) {
        const cents = netCents[otherId];

        if (cents > 0) {
            owed.push({ id: otherId, amount: cents / 100 });
            owedToYouCents += cents;
        } else if (cents < 0) {
            owes.push({ id: otherId, amount: -cents / 100 });
            owedCents += -cents;
        }
    }

    return {
        owes: owes,
        owed: owed,
        totalOwed: owedCents / 100,
        totalOwedToYou: owedToYouCents / 100,
        netTotal: (owedToYouCents - owedCents) / 100,
        settled: owes.length === 0 && owed.length === 0,
    };
}