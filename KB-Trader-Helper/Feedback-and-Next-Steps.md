# TODO / FEATURE NOTES

## PDA / UI

- Make TSV button smaller on PDA, similar size/style to the FF button.
- Disable TSV entirely on racing page.
- Add compact badge mode for PDA/mobile so item cards do not become too crowded.
- Add expanded info mode for desktop/browser where there is more room for details.
- Extra item info should be available through hover, click/tap, or a small info button instead of always displaying everything.

## Floater / Dashboard UX

- Keep the small floater for quick status only:
  - TSV button
  - profitable item count
  - quick enable/disable toggle
  - current mode/status if useful
- Replace the long floating settings list with a dashboard/settings overlay.
- TSV button should open a dashboard-style overlay on the current page so trading flow is not interrupted.
- Current dashboard tab ideas:
  - Overview
  - Highlights
  - Traders
  - Rules
  - Shop
  - Cache/API
  - Debug
- Keep item-specific rule editing near the item itself.
- Global settings belong in the dashboard.

## Highlight Logic

- Add optional setting to hide/show exact NPC sell value matches, such as `=SELL +$0`.
- Add strict `<` option in addition to existing `<=` pricing rules.
- Add minimum flat profit threshold.
  - Example: only highlight if estimated profit is at least `$10,000`.
- Add minimum profit percent threshold.
  - Example: only highlight if estimated profit is at least `5%`.
- Add “actionable only” mode:
  - only show highlights when estimated profit meets the user’s minimum threshold.
- Keep profit logic separated by source:
  - NPC sell
  - market resale
  - bazaar resale
  - trader price list

## Market Value / Cache

- Torn market value comes from Torn’s item API field, not guessed listings, but it changes over time; show cache age, refresh status, and stale-data warnings in the dashboard.
- Torn item data is currently cached for 30 days.
- Consider splitting cache timing:
  - NPC sell values: long cache, such as 30 days
  - Torn market values: shorter cache, such as weekly or daily
  - trader price lists: shorter cache, such as daily or less depending on source limits

## Badge / Info Display

- Use compact badges by default on PDA/mobile.
- Browser/desktop can support fuller badge details.
- Compact badge examples:
  - `NPC +$8k`
  - `MKT +$31k`
  - `W3B +$42k`
  - `Rule`
- Expanded info examples:
  - `Buy: $410,000`
  - `Sell to Weav3r: $455,000`
  - `Profit: +$45,000`
  - `Market resale after 5% fee: +$22,300`
- Approach idea:
  - card badge = quick answer
  - expanded detail = full explanation

## Rule Editor Improvements

- When editing an existing custom rule, auto-populate the saved values instead of opening blank/default fields.
- Allow viewing, updating, and deleting existing rule configuration directly from the item.
- Make it visually clear when an item already has a saved custom rule.
- Add strict less-than rule type:
  - fixed price `< $X`
  - percent of market `< X%`
  - percent of NPC sell `< X%`
- Add a dashboard table for saved/custom-tracked items showing item name, ID, saved rule/value, NPC sell price, Torn market value, highlight color, and cache age.
- Allow saved rules to be edited either from the item card or directly from the dashboard table.
- Add sorting/filtering for bulk review, such as by item name, rule type, profit threshold, market value, NPC sell value, or stale data.

## Trader Price List Features

### Phase 1: Saved Specific Traders

- Let user add multiple specific trader price lists.
- Support W3B / Torn Exchange / custom trader URLs where feasible.
- Highlight item if current item price is profitable against a saved trader price.
- Badge should show trader name and estimated profit.
- Example: `Weav3r +$42,500`
- Add toggles to enable/disable individual traders.
- Allow multiple traders to be active simultaneously.
- If multiple saved traders are profitable:
  - show best trader only on the card to avoid clutter
  - show all matching traders in expanded info/details
- Prioritize speed, low latency, minimal requests, and cached trader data.
- Cache trader price lists, but keep the cache short enough for trading accuracy.
- Trader cache ideas:
  - manual refresh
  - auto-refresh every hour to daily when enabled
  - show last refreshed time
  - warn when trader data is stale

### Phase 2: Best Trader Lookup

- Optional mode to search best X traders per item.
- User-configurable:
  - number of traders checked/top prices
  - minimum trader rating
  - possibly online/recently active only
- Badge should show trader name, trader price, and estimated profit.
- Example: `Best: TraderName +$51,200`
- This should not run constantly during active trading.
- Best trader lookup should be manual, cached, or limited to already-highlighted items.
- This may not be feasible at scale due to API limits, rate limits, latency, and the need for fast trading decisions.

## Saved Trader Mode vs Best Trader Mode

- Keep “specific saved trader mode” separate from “best trader lookup mode.”
- Specific saved trader mode should be the first priority because it is predictable and faster.
- Best trader lookup should be treated as experimental until API/data limits are understood.
- Safer best-trader behavior:
  - user clicks “check best traders now”
  - only check visible highlighted items
  - only check one selected item
  - cache results
  - show last checked time

## Opportunity List / Action Center

- Add an opportunity list in the dashboard showing profitable items found on the current page.
- Suggested columns:
  - Item
  - Buy price
  - Sell target
  - Profit
  - Source
  - Cache age / confidence
- Allow sorting by highest profit, percent profit, source type, or trader.
- Clicking an item in the list should locate/highlight the item on the page.
- This gives users an all-in-one view without overcrowding cards.

## Trade Flow Helpers

- Goal: reduce the need to open external references while trading.
- The script should answer:
  - Is this worth buying right now?
  - Who would I sell it to?
  - How much would I make?
  - Is the profit enough to care?
  - Is this a real opportunity or noise?
- Potential helper features:
  - suggested buy/no-buy status
  - suggested sell target
  - fee-aware profit estimate
  - trader-specific profit estimate
  - quick copy price/trader info
  - optional price fill helper if appropriate

## Noise Control

- Add settings to reduce non-actionable highlights.
- Exact sell value highlights should be optional.
- Add separate minimum profit/percent thresholds for:
  - NPC sell
  - market resale
  - trader resale
  - custom rules
- Avoid flooding the page with low-value highlights.

## Safety / Accuracy

- Show last refresh time for Torn item data and trader/custom price lists.
- Add manual refresh buttons.
- Show failed request messages in the dashboard.
- Warn when data may be stale.
- If using external listing data, consider safeguards:
  - ignore extreme outliers
  - avoid relying on one weird listing
  - show source used for each profit estimate

## Cache / API Design

- Cache aggressively where possible.
- Avoid live calls during rapid trading unless explicitly requested.
- Keep trading workflow fast.
- Dashboard should show:
  - last Torn API refresh
  - last trader list refresh
  - failed request messages
  - cache clear/reload option
- Avoid automatically checking too many traders/items.
- Treat rate limits and latency as major design constraints.

## Already Present / Partially Present in Current Code

- Draggable HUD already exists.
- Basic badge display toggles already exist.
- Torn item API cache already exists.
- Desktop menu command to clear cache/re-fetch already exists.
- Shop buy/sell highlighting already exists.
- Shop badge toggles already exist.
- Per-item rule creation exists.
- PDA API key handling exists.
- Existing custom rule editing partially implemented but needs fixing because saved rule data and editor-loading format do not fully line up.


