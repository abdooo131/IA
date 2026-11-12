# Standard operating procedures for every role, in English and Arabic. One source:
# build.py writes them into the web app's messages (shown at /help) and into docs/sop/*.md.
# Shape per role: title, who, day (the daily routine), escalation (who tells whom), and
# sections of: title, steps (do this, in order), check (how to know it went right),
# problems (if this happens, do that and tell whom). Both languages keep the same shape.

EN = {
  "store_staff": {
    "title": "Dark store staff",
    "who": "Receivers, pickers and packers in a dark store or the hub. Your store opens from Home after you sign in.",
    "day": [
      "Start of shift (first 10 minutes): sign in, open your store, read Orders (red = late), check the scanner reads a barcode, check the Receive and Put away counts.",
      "Every hour: Orders first, always. Between orders: put away, then returns and transfers, then counts.",
      "Before a rider leaves: every packed order has its photo and was handed over by scanning the badge.",
      "End of shift (last 15 minutes): receive cash from every rider who is back, put away everything in receiving, receive goods back from failed deliveries, and write a ticket to the next shift lead about anything open."
    ],
    "escalation": [
      "An order will be late, or a product is missing on the shelf: tap Missing on the order (admin is alerted automatically) and tell your store lead.",
      "A shipment arrives without a shipment number from the merchant: do not take it; open a ticket to admin with the merchant name and number of boxes.",
      "Cash does not match: enter what you counted; finance reviews it. Do not change the count.",
      "Scanner, phone or internet down for more than 10 minutes: call your store lead; they open an urgent ticket to admin.",
      "Anything you are not sure about: ticket to your store lead before you act."
    ],
    "sections": [
      {"title": "Clock in and out",
       "steps": [
         "At the store, open your store's home and tap Clock in at the top. Allow location when the phone asks.",
         "Your phone must be inside the store (within 150 m) with GPS on; the card then shows the time you clocked in and if you were late.",
         "At the end of your shift tap Clock out, also at the store."],
       "check": [
         "The card shows Clocked in at the time you arrived; My HR in the Settings menu shows your month."],
       "problems": [
         "Too far or not precise enough: step outside or near a window, turn on GPS and try again.",
         "Location blocked: allow location for the site in the browser settings.",
         "Phone dead or forgotten: tell your store lead; HR adds the punch with a reason. A forgotten clock out is closed at your shift end and flagged."]},
      {"title": "Receive a merchant shipment",
       "steps": [
         "Ask the driver for the merchant's shipment reference. No shipment in Receive for that merchant means no receiving: call admin.",
         "Open Receive and choose that shipment. Check the merchant name matches the boxes.",
         "Open one box at a time. Scan every unit. Each scan adds 1 to the receiving bin.",
         "Damaged on arrival: put it aside; after closing, report it in Damaged and held with cause Arrived damaged.",
         "When all boxes are empty, tap Close shipment and confirm."],
       "check": [
         "The screen shows received against expected for every product.",
         "The shipment's status bar shows Received.",
         "The receiving bin count went up by what you scanned (Put away shows it)."],
       "problems": [
         "Barcode refused (not in catalog): put the item aside, take a photo of the label, and open a ticket to admin with the merchant name.",
         "More units than expected: receive them anyway; the merchant sees them as extra.",
         "You closed by mistake: tell admin by ticket at once; do not receive the rest on another shipment."]},
      {"title": "Put away",
       "steps": [
         "Open Put away. Pick up the units from the receiving bin.",
         "Scan the product, then scan the shelf label where you place it.",
         "Repeat until the receiving bin is empty."],
       "check": [
         "Put away on Home shows 0 units to shelve.",
         "The product is on the shelf whose label you scanned."],
       "problems": [
         "Shelf full: use the next empty shelf and scan that one.",
         "No shelf label: print it from Bin labels before placing anything there."]},
      {"title": "Pick an order",
       "steps": [
         "Open Orders and tap the top order (oldest first, red is late). Tap Accept if it is new.",
         "Go to the shelf shown. Scan the shelf (optional), then each product.",
         "If a product is not there, tap Missing for it. Never replace it with something else."],
       "check": [
         "Every line shows picked equal to ordered (or the missing units are marked).",
         "The status bar moves to Picking, then Packed after packing."],
       "problems": [
         "Wrong product scanned: the screen refuses it; scan the right one.",
         "Product damaged on the shelf: tap Missing, then report it in Damaged and held with cause Store handling."]},
      {"title": "Pack and hand to the rider",
       "steps": [
         "Pack all items, close the bag and stick the order label.",
         "Take a clear photo of the closed bag. Packing does not finish without it.",
         "When the rider arrives, scan the rider's badge.",
         "Give the bags and say the number of bags out loud."],
       "check": [
         "The status bar shows Out for delivery.",
         "The rider's screen shows the order with the right number of units."],
       "problems": [
         "The screen refuses to add an order to a rider's trip: an order on the trip would be late; give it to another rider.",
         "Wrong badge scanned: call admin; do not let the rider leave with the order."]},
      {"title": "Cash from riders",
       "steps": [
         "Open Cash and choose the rider.",
         "Count the money in front of the rider, twice.",
         "Type exactly what you counted and save.",
         "Put the cash in the store box at once."],
       "check": [
         "The handover shows Balanced, or Waiting if it differs (finance reviews it).",
         "The store box total in Cash went up by the amount."],
       "problems": [
         "Short or over: save the real count anyway, write a note (what the rider said), and the difference goes to finance.",
         "Rider refuses to wait for the count: do not save; tell the store lead."]},
      {"title": "Failed deliveries and returns to merchants",
       "steps": [
         "When a rider brings goods back: open the order and tap Receive goods back.",
         "Merchant return: open Returns, choose the return, scan each unit listed.",
         "When ready, hand it to the merchant's driver and type the driver's full name."],
       "check": [
         "The order shows the goods are back; the return shows Collected."],
       "problems": [
         "Goods not back within 2 hours of a failed attempt: admin gets an alert; find the rider and ask."]},
      {"title": "Damaged stock, counts and transfers",
       "steps": [
         "Damaged: open Damaged and held, scan the unit, choose the cause, save.",
         "Count: open Stock count, scan the bin, scan every unit you find; you are not shown the expected number.",
         "Transfer to send: open Transfers, pick by scan, tap Send.",
         "Transfer received: scan every unit into receiving, close it, then put away."],
       "check": [
         "Damaged units are no longer on sale.",
         "The count shows Submitted; admin approves differences.",
         "The transfer status bar shows In transit (sent) or Received."],
       "problems": [
         "Units for a transfer not found: send what you have; the missing units are released and admin is told."]},
      {"title": "Packaging (bags, boxes, labels)",
       "steps": [
         "When you pack, choose the box size if you used one of our boxes; the bag, label and tape of the recipe are taken by themselves.",
         "Use only what the recipe says for that merchant; if an order needed more, tell your store lead.",
         "Once a week (or when admin asks), count the packaging: Inventory, Packaging, Count, choose the item and type the units on the shelf."],
       "check": [
         "After packing, the store's packaging stock is lower by what the order used.",
         "The count shows the number you typed."],
       "problems": [
         "The screen says the store ran short of packaging: pack anyway with what you have and tell your store lead; admin is alerted.",
         "Packaging is low (alert on Home or in Alerts): your store lead asks finance for a purchase order."]}
    ]},
  "rider": {
    "title": "Rider",
    "who": "Riders delivering 60 minute orders from one dark store.",
    "day": [
      "Start of shift: sign in, allow location, check your phone battery is above 50% and you have change for cash orders.",
      "For every trip: take orders only by badge scan at the store; check the number of bags.",
      "After every trip: come back to the store, give back failed goods, and hand any cash over if your lead asks.",
      "End of shift: hand all cash to the store and watch it being counted. Nothing stays with you overnight."
    ],
    "escalation": [
      "Customer not answering after the calls the app asks for: mark it failed with the door photo; the store lead decides the next step.",
      "Accident, police or danger: stop, stay safe, call your store lead at once.",
      "Wrong amount of cash collected: type exactly what you got; finance will review it.",
      "App not working: call the store lead; do not hand over a package without the code or a photo."
    ],
    "sections": [
      {"title": "Clock in and out",
       "steps": [
         "At your store, open the rider app and tap Clock in at the top. Allow location when the phone asks.",
         "You must be at the store (within 150 m) with GPS on.",
         "When your shift ends and your cash is handed over, tap Clock out at the store."],
       "check": [
         "The card shows Clocked in at the time you arrived."],
       "problems": [
         "Store says you are not clocked in when handing you an order: clock in first (some stores require it).",
         "Too far or not precise: go to the store, turn on GPS and try again; if it still fails call the store lead."]},
      {"title": "Deliver an order",
       "steps": [
         "Open the order and tap Directions.",
         "At the address, call from the app if you cannot find it.",
         "Ask for the 4 digit customer code and type it, or take a photo of the handover.",
         "Cash order: take exactly the amount shown, type what you got, tap Delivered."],
       "check": [
         "The order moves to Finished today as Delivered.",
         "Today's cash total went up by the amount."],
       "problems": [
         "Code wrong: check it again with the customer; never deliver without the code or a photo.",
         "Customer has no change: do not give change from the company cash; call the store lead."]},
      {"title": "When you cannot deliver",
       "steps": [
         "Customer not answering: call from the app as many times as it asks, then take a photo of the door.",
         "Tap Could not deliver, choose the reason, add details if Other.",
         "Bring the goods back to the store on the same trip."],
       "check": [
         "The order shows Attempt failed or Failed.",
         "Store staff tapped Receive goods back."],
       "problems": [
         "You cannot get back to the store: call the store lead; never keep goods overnight."]},
      {"title": "Cash at the end of the shift",
       "steps": [
         "Go to the store with all the cash you collected.",
         "Hand it over and watch it being counted.",
         "Check that the counted total matches your app's total for today."],
       "check": [
         "The store's screen shows Balanced."],
       "problems": [
         "Difference: tell staff what happened so they write it in the note; finance decides."]}
    ]},
  "merchant": {
    "title": "Merchant",
    "who": "Shops selling with Shiply Now 60 minute delivery.",
    "day": [
      "Every morning: check Orders and Notifications; check stock you are low on in Products.",
      "Before sending stock: create the shipment first, then send.",
      "Every week: check your Wallet and statement; make sure your payout schedule is right."
    ],
    "escalation": [
      "A question about an order or money: write to Shiply support (your account manager) with the order or payout number.",
      "Something missing after a shipment was received: reply with the shipment number and the product SKU within 48 hours."
    ],
    "sections": [
      {"title": "Start selling",
       "steps": [
         "Add your products (one by one, by file, or by linking your Shopify store). Every product needs a barcode.",
         "Set your 60 minute delivery price in Delivery.",
         "Create your first shipment so we can receive stock."],
       "check": [
         "The checklist on Home is all ticked."],
       "problems": [
         "A barcode is refused: it already belongs to another product; use the real barcode on the item."]},
      {"title": "Send stock",
       "steps": [
         "Shipments, New shipment: list each product and quantity.",
         "Write the shipment number on every box.",
         "Send the boxes to the address shown."],
       "check": [
         "The shipment goes Expected, Receiving, Received.",
         "You get a summary: expected against received."],
       "problems": [
         "Extra units: they are received and shown as extra; nothing to do."]},
      {"title": "Orders and money",
       "steps": [
         "Shopify orders with the 60 minute option arrive by themselves; you can also add one in New order: search the customer's neighbourhood and, if you know the building, drop a pin on the map. The form tells you at once whether the store can take it.",
         "You can cancel only new or accepted orders.",
         "Wallet shows what we owe you; payouts go to your bank on your schedule.",
         "Contract shows your agreement with Shiply: every price beside the standard one (often one shipping fee per delivered shipment that includes the rest), any price per product, what a failed delivery costs, volume tiers, payment terms, promises and dates. Try the calculator with your own products. Download it as a PDF in English or Arabic; earlier versions stay in Versions."],
       "check": [
         "Each payout shows a bank reference.",
         "The fees on your statement match the prices of the contract version in force that day."],
       "problems": [
         "A payout looks wrong: download the statement for the period and send it with your question."]},
      {"title": "Your team",
       "steps": [
         "Owners open Team to add the people who work on the account: name, email, password, and owner or member.",
         "Members get only the rights you tick: orders, stock, money, settings.",
         "Someone leaves: Disable them the same day; they are signed out everywhere."],
       "check": [
         "A member sees only the menu items of their rights."],
       "problems": [
         "You cannot lower or disable yourself, and one active owner always stays: make someone else owner first."]}
    ]},
  "finance": {
    "title": "Finance",
    "who": "The finance team and the accountant. Everything is in Finance.",
    "day": [
      "Every morning (30 minutes): Overview; review every cash difference in Cash; deposit yesterday's store cash to the bank (choose the bank, write the slip number).",
      "Payout days: Payouts, prepare due payouts, check each, transfer from the bank, mark paid with the bank reference.",
      "Every bill or money movement the same day it happens: Money movements, with the paper receipt's number as reference.",
      "End of month: trial balance, profit and loss, balance sheet, bank statement check, CSVs to the accountant."
    ],
    "escalation": [
      "A rider is short more than once in a week: ticket to admin with the CH- numbers.",
      "A payout bounced or a bank figure does not match: ticket to admin; do not book a correction until you know why.",
      "The trial balance does not balance: stop and open an urgent ticket to admin (it should never happen)."
    ],
    "sections": [
      {"title": "Review a cash difference",
       "steps": [
         "Cash, Waiting for you: open the handover (CH-...).",
         "Read the note and talk to the store lead if needed.",
         "Write it off (company loss) or keep it on the rider, always with a reason."],
       "check": [
         "The handover leaves the waiting list; the rider's cash in Riders is right."],
       "problems": [
         "You are not sure who is right: ticket to the store lead; decide only after the answer."]},
      {"title": "Deposit store cash to the bank",
       "steps": [
         "Cash, the store, enter the amount and the bank slip number, choose the bank, Deposit.",
         "Keep the slip; write the JV number on it."],
       "check": [
         "The store box goes down and the bank account (Chart of accounts) goes up by the same amount."],
       "problems": [
         "Deposited to the wrong bank: book a Transfer between the two banks with the reason; never delete."]},
      {"title": "Record money movements",
       "steps": [
         "Transfer: from one bank or box to another.",
         "Expense: choose the category and where it was paid from; enter VAT if the bill shows it.",
         "Owner money: capital in or drawings out.",
         "Journal entry: corrections, with a written reason. Debits must equal credits."],
       "check": [
         "You get a voucher number (JV-...). Write it on the receipt and file it.",
         "The account statement shows the line with the right balance after it."],
       "problems": [
         "Not enough money in the account: the screen refuses; check the date and the account."]},
      {"title": "Merchant payouts",
       "steps": [
         "Payouts, prepare due payouts for the day.",
         "Open each draft (PAY-...) and compare with the merchant's statement.",
         "Download the bank transfer file at the top of Payouts and upload it to CIB's bulk transfer (merchants without a bank account are listed; they fill it in their Wallet).",
         "After the bank confirms, Mark paid with the bank reference and the bank used."],
       "check": [
         "The payout shows Paid; the merchant's balance dropped by the amount."],
       "problems": [
         "Amount looks wrong: cancel the draft with a note and open a ticket to admin.",
         "A merchant is skipped with below_payout_minimum: we owe them less than the minimum payout of their contract (else Accounting's payout minimum setting); it waits until the balance reaches it."]},
      {"title": "Approvals and receipts",
       "steps": [
         "Approvals: every money in claim, and money out from the approval limit, waits here for a second person.",
         "Open each one, check the receipt or bank slip, then Approve or Reject with a reason. You cannot approve your own.",
         "Receipts: attach the photo of the paper receipt or transfer slip to every movement listed there."],
       "check": [
         "Approved items get a JV number; the Receipts list gets shorter every day."],
       "problems": [
         "Something waits that you never asked for: reject it and open an urgent ticket to admin."]},
      {"title": "Close the month",
       "steps": [
         "After the month end checks pass, Close the books through the last day of the month.",
         "Nothing can be posted before that day any more; only someone who manages settings (the owner) can reopen, with a written reason."],
       "check": [
         "Close the books shows the new closed through day."],
       "problems": [
         "A late bill for a closed month: enter it today with a note; ask admin only if it must sit in the old month."]},
      {"title": "Salaries and advances",
       "steps": [
         "Salaries: HR keeps each person's employment (employee or outsourced, with their company) and salary package (basic plus allowances, from a day on). Payroll shows them read only; ask HR for any change.",
         "An advance: choose the person, amount and the bank or box it is paid from.",
         "Month end: choose the month and the bank, enter bonuses, deductions and advances to take back, Check the run (tax, insurance, martyrs fund per person), then Pay; print the payslips.",
         "Outsourced people: enter their company's monthly bill per person in Suppliers and bills; take advances back when paying that bill; pay their bonuses here.",
         "Each month pay salary tax, social insurance and the martyrs fund from Taxes."],
       "check": [
         "Each person's advance owed goes down; the run shows in Approvals when it is above the limit."],
       "problems": [
         "Someone is missing from the run: HR has not set their salary package yet; ask HR (a ticket to the HR manager)."]},
      {"title": "Supplier bills",
       "steps": [
         "Suppliers and bills: add the supplier once with their tax id and withholding % (ask the accountant).",
         "New bill the day it arrives: supplier, their invoice number, dates, category, store, amount before VAT and the VAT.",
         "To pay: open the bill, enter the amount, the bank and the transfer reference. The withholding tax is kept back by itself.",
         "Look at What we owe, by how late every week; pay the red columns first."],
       "check": [
         "A paid bill leaves Open bills; the supplier's We owe goes to zero."],
       "problems": [
         "Bill entered twice or wrong: Cancel bill with a reason (only before any payment)."]},
      {"title": "Taxes",
       "steps": [
         "Taxes shows the VAT and withholding tax we owe today.",
         "Every quarter: open the quarter, give the list to the accountant for form 41, then Pay tax (withholding) for the total.",
         "Every month: Tax returns gives the VAT return boxes; after the accountant files it, Pay tax (VAT) for the amount filed.",
         "Every month: Tax returns gives the salary tax and insurance lists (CSV); pay both from Taxes.",
         "Every quarter: Tax returns, download the form 41 CSV and upload it to the tax portal.",
         "After the year ends: Tax returns, company income tax; book the amount agreed with the accountant before closing the year."],
       "check": [
         "The amount owed goes down by what you paid."],
       "problems": [
         "A supplier has no tax id: add it on the supplier before filing."]},
      {"title": "Recurring, prepaid and equipment",
       "steps": [
         "Recurring expenses: rent, internet and the like; each month on its day it waits in Approvals.",
         "Prepaid and equipment: rent paid ahead goes in Pay ahead; shelves, fridges and motorbikes in Buy equipment.",
         "Each month end the system moves the right part to the expense or depreciation by itself."],
       "check": [
         "Months charged goes up by one every month."],
       "problems": [
         "A recurring expense changed price: stop the old one and add a new one."]},
      {"title": "Merchants who owe us",
       "steps": [
         "Owed by merchants lists every merchant whose fees passed the cash we collected.",
         "Call them, then Ask to pay (they see it in their panel).",
         "When they transfer, enter it in Merchants as a payment from the merchant."],
       "check": [
         "The merchant leaves the list once their balance is back to zero or above."],
       "problems": [
         "Owed for more than 30 days: ticket to admin."]},
      {"title": "Bank matching",
       "steps": [
         "Every week: download the statement from CIB online banking as Excel (.xlsx) or CSV.",
         "Bank matching, choose the bank, choose the file; check the columns it picked and the first lines, then Import statement.",
         "In the bank, not in the books: bank fees go to Book as bank charges; money that came in is entered as a merchant receipt or owner capital first; a bank error is set aside with a reason.",
         "In the books, not in the bank: find out why (a deposit not made, a cheque not cleared)."],
       "check": [
         "Both lists are empty and the difference shows Matches."],
       "problems": [
         "An entry in the books that never reached the bank after a week: urgent ticket to admin with the JV number."]},
      {"title": "VAT, budgets and cash",
       "steps": [
         "VAT report: each month give the accountant the month's line for the VAT return, then record the payment in Taxes.",
         "Budgets: before each month, enter the budget per account (per store or for the company); look at better or worse every week.",
         "Cash flow: read the next four weeks every Monday; if money runs out, tell admin the same day."],
       "check": [
         "The forecast's last week ends above zero."],
       "problems": [
         "A cost far above budget: ticket to admin with the account and the amount."]},
      {"title": "Year end and exports",
       "steps": [
         "In January, after the December checks: Year end and export, Close year for last year (approvers only).",
         "For the accountant: choose the days and Download journal (CSV); it imports into Odoo, Zoho Books, QuickBooks or Daftra.",
         "For the auditor: Download audit pack (zip) with the journal, trial balance, chart of accounts, VAT and receipt photos."],
       "check": [
         "The year shows Closed with a JV number; last year's profit and loss still reads the same."],
       "problems": [
         "Close the earlier year first: close the years in order, oldest first."]},
      {"title": "Tax invoices and the e-invoice system",
       "steps": [
         "First days of each month: Tax invoices, choose last month, Issue the month's invoices.",
         "On the finance PC with the company's USB token: run the signing program (docs/ETA.md); it signs and sends every waiting invoice.",
         "Check that each invoice turns Valid; open a Rejected or Invalid one, fix the reason shown and press Send again.",
         "Giving fees back: open the invoice, Credit note with the amount and reason; a second person approves it."],
       "check": [
         "Every invoice of the month is Valid; merchants see them under Invoices."],
       "problems": [
         "The signing program shows an error: send the message to admin; do not create the invoices again."]},
      {"title": "Foreign bills, equipment and accruals",
       "steps": [
         "A bill in dollars or another currency: choose the currency and the rate on the bill; when paying, type the amount in that currency and today's rate. The difference goes to exchange differences by itself.",
         "Equipment sold or scrapped: Prepaid and equipment, Sell or scrap, with the price (0 if scrapped) and why; a second person approves.",
         "A cost of this month whose bill comes later: Journal entry with Reverse on the 1st of next month."],
       "check": [
         "Sold equipment shows Sold or scrapped and stops depreciating."],
       "problems": [
         "A rate typed wrong on a bill: cancel the bill (before paying) and enter it again."]},
      {"title": "Cheques",
       "steps": [
         "Cheques, Register a cheque: choose Received or Issued and what it is for (merchant balance, security deposit, supplier refund, other income; or a bill, a payout, a deposit paid back), type the printed number, the bank, the amount, the issue and due dates, and attach a photo of the cheque.",
         "A cheque given to us always waits for a second person in Approvals; a cheque we write waits from the approval limit. Until then it shows Waiting for approval.",
         "Every morning look at the Due list: overdue cheques first. Deposit at bank when you hand a received cheque to the bank, Bank paid it when the money shows on the statement (never before its due day).",
         "A cheque came back unpaid: Bounced with the bank's reason. The debt comes back on the merchant, supplier or bill, a payout paid by it is cancelled, and admin gets an alert."],
       "check": [
         "Cheques under collection (1151) equals the received cheques not yet cleared; cheques payable (2451) equals the issued ones not yet paid by the bank."],
       "problems": [
         "Wrong amount or party: Cancel cheque with the reason (only before it is deposited or cleared), then register it again.",
         "The bill was paid in part meanwhile and the cheque no longer fits: cancel it and write a new one."]},
      {"title": "Merchant contracts, deposits and profitability",
       "steps": [
         "Merchant contracts: read each merchant's contract version in force, the deposit we hold and their balance against the credit limit; the merchant's name opens the whole contract (prices, tiers, payment terms) in Merchants.",
         "Security deposit: Deposit on the merchant's row, Received or Paid back, through our bank or the merchant's balance; a second person approves it.",
         "The monthly minimum is topped up by itself on the 1st for the month before (Monthly minimum top up in the journal and on the invoice).",
         "Profit per merchant: open a month, then a merchant to see fees by kind, costs and margin per order; use What if to try other fees on the same month before talking to the merchant."],
       "check": [
         "Deposits held (2600 wallets) match the signed contracts; no merchant shows Over limit without a ticket open with their account manager."],
       "problems": [
         "A merchant is over the credit limit and cannot send shipments: ask them to pay, record the receipt, and shipments open again at once."]},
      {"title": "Month end",
       "steps": [
         "Trial balance for the month: debits must equal credits.",
         "Profit and loss for the month; balance sheet at the last day.",
         "Compare each bank account statement in Shiply with the real bank statement; book bank charges as an Expense in 5501.",
         "Download the journal and statements as CSV for the accountant."],
       "check": [
         "Bank balances in Shiply equal the bank statements.",
         "The balance sheet says Assets equal liabilities plus equity."],
       "problems": [
         "A difference you cannot explain: ticket to admin with the account code and the amount."]},
      {"title": "Purchase orders and packaging",
       "steps": [
         "Accounting, Vendors, Purchase orders: choose the supplier, the store (needed for packaging), add lines (packaging item or an expense category, quantity, unit price) and attach the quote photo.",
         "Below the approval limit it is approved at once; above it another person with the approve level approves it.",
         "Mark it as sent to the supplier. When goods arrive, enter what came on the order (it can come in parts): packaging goes into the store's stock.",
         "When the supplier's invoice arrives, Make the bill on the order with their invoice number; then pay it from Bills as usual.",
         "Close the order when it is complete, or when the supplier will not send the rest (with a note).",
         "Packaging bought in a shop and paid now: Inventory, Packaging, Buy and pay now, with the receipt photo."],
       "check": [
         "The order's status bar shows Billed or Closed and its bill appears under Bills.",
         "Packaging stock value (Inventory, Packaging) equals account 1402 in the trial balance; 2401 is zero once everything received is billed."],
       "problems": [
         "The bill is refused as above the order: check the supplier's prices; ask admin to change finance.po_bill_tolerance_bp only if agreed.",
         "Goods came that were not ordered: do not receive them on the order; open a new purchase order."]},
      {"title": "Emails to merchants",
       "steps": [
         "Marking a payout paid emails the merchant a payout notice and the statement of that period with the CSV; issuing the month's invoices emails each merchant a link to print theirs.",
         "Accounting, Merchants, Emails to merchants shows every email: Waiting, Sent or Failed. Open Preview to see it as the merchant does.",
         "A Failed email: check the address with the merchant (they change it in Wallet), then tap Send again."],
       "check": [
         "After a payout, two emails show Sent for that merchant within a minute."],
       "problems": [
         "The page says email is not set up: tell admin; emails wait until SMTP is configured.",
         "A merchant says they never got the email: check Sent, then ask them to look in spam."]}
    ]},
  "admin": {
    "title": "Admin",
    "who": "The team running operations. Home shows the apps your job role opens; the owner opens everything.",
    "day": [
      "Every morning: Overview, then Alerts (handle each one), then Tickets (For me).",
      "Every hour at peak: Orders, late ones first; call the store lead of any red store.",
      "Every evening after 21:00: Transfers, approve or edit tonight's refill drafts.",
      "Every week: Merchants (sign ups), Counts (approve differences), Damage (settle), Settings (check nothing changed by mistake)."
    ],
    "escalation": [
      "You receive what nobody else can decide: missing stock, money differences, merchant complaints, broken equipment.",
      "Use Tickets to ask anyone; every ticket has an answer time and a reminder.",
      "Shopify, payments or the server down: ticket to the tech lead (urgent) and tell the stores to take manual orders only after you say so."
    ],
    "sections": [
      {"title": "Attendance and shifts",
       "steps": [
         "HR, Configuration, Attendance setup: Shifts (start, end, break, days) and Official holidays; HR settings hold the clock in distance, grace and overtime minutes, and the office location.",
         "HR, Time, Roster: set each person's default shift; the coming two weeks are planned from it; change a day by hand when needed.",
         "HR, Time, Today: who is in, late, missing or off at each store. Days: closed days with late, overtime and hours, and a CSV export.",
         "Open a day to correct it: add a punch the phone could not make, void a wrong one, or set the status; every correction needs a reason."],
       "check": [
         "Yesterday's days are closed the morning after; a forgotten clock out shows the flag."],
       "problems": [
         "A person cannot clock in (too far): check their store on the file, the store's location and hr.clock_radius_m.",
         "Office staff cannot clock in: set hr.office_lat and hr.office_lng."]},
      {"title": "Stores, hubs and zones",
       "steps": [
         "Dark stores and hubs: open a location with a short code (letters and numbers), the address and the map position.",
         "Delivery zones: pick the store, create a zone (code and names), then tap neighbourhoods on the map to add them; tap again to remove, Mark not served for a place we never go. Select areas in a shape adds many at once.",
         "To review: decide each area that was split between two stores (keep, move or not served).",
         "Address map: run the OpenStreetMap import once, then approve the names it learns each week."],
       "check": [
         "Try an address on the Address map page: it lands in the right store."],
       "problems": [
         "An area belongs to another store: tapping it asks before moving it.",
         "Orders say address_unsure: the address names a district split between stores; add the missing neighbourhoods or ask for the neighbourhood or a pin."]},
      {"title": "Merchants, products and Shopify",
       "steps": [
         "Merchants: approve or reject sign ups with a reason.",
         "Shopify: link the merchant to their store, send them the install link, then create locations.",
         "Products: import the product file; every barcode must be unique."],
       "check": [
         "The Shopify card shows locations and linked products."],
       "problems": [
         "A merchant moved to a new Shopify store: Disconnect store, then link the new one."]},
      {"title": "Merchant contracts",
       "steps": [
         "Merchants: open a merchant; the tabs are Overview, Contract, Shopify, Products and stock, Users, Profit (with Accounting) and History.",
         "Contract, Edit (new version): every price beside the standard one (leave empty for the standard price, type 0 for no charge), volume tiers on any fee (Orders a month: from the nth delivered order, the prices that change), payment terms (payout schedule, minimum payout, monthly minimum, deposit, credit limit), promises (delivery promise, attempts included, stores, areas), dates, special terms and an internal note. Save draft changes nothing yet.",
         "All inclusive merchants: tap Apply all inclusive, then type the shipping fee (for example 120 EGP). It sets order fee, COD, receiving, storage, returns and packaging to 0 and failed deliveries to 100% of the shipment. Packaging stays our cost unless you type a packaging charge.",
         "Price per product: find the merchant's products by SKU or name and type a price per unit, or tick several and Set price for all of them, or Import CSV (sku, price_egp; one wrong row and nothing changes). Download prices gives the saved version's list. Each delivered unit is charged its product's price; cancelled units and products without a price are not. Tiers do not apply to these prices.",
         "Failed delivery: a fixed fee typed is used as it is; otherwise the share of the shipment (shipping fee, product prices and order fee; never COD).",
         "Check the draft with the calculator (an example shipment of the merchant's products, cash or prepaid, its value and what a failed attempt costs; a month of shipments and units), then Activate from today or a later day. Charges from that day use the new version; earlier versions stay in Versions and print as before.",
         "Attach the signed copy (PDF, JPG or PNG up to 5 MB) under Signed copies, and print the contract in English or Arabic from PDF English / PDF عربي.",
         "The payout bank account is edited from the contract's payment terms.",
         "Tiers apply from the order that crosses the band, never to earlier orders of the month; unit fees and failed deliveries use the band of the next delivered order."],
       "check": [
         "The merchant sees the contract in force read only under Contract (with the PDF); History shows every draft, activation and file.",
         "Accounting's fee settings are only the standard prices: a merchant's own price is in their contract."],
       "problems": [
         "Shipments refused for a merchant over the credit limit: the alert names the balance; finance records the payment or you raise the limit with the owner's agreement."]},
      {"title": "Stock",
       "steps": [
         "Counts: approve or reject each difference.",
         "Damage: confirm the cause; company causes credit the merchant.",
         "Transfers: approve, edit quantities, or cancel before picking starts."],
       "check": [
         "Stock on the Stock page matches what staff see on the shelves."],
       "problems": [
         "A count is stale: ask the store to count the bin again."]},
      {"title": "People (HR app)",
       "steps": [
         "Open HR: the HR home shows what needs you today: who is in, late, absent or on leave now, what waits in the inbox, suggested violations, documents missing or running out, joining and leaving checklists, probation and contracts ending in 30 days, birthdays and work anniversaries this week, and the headcount. Each card has a button to act.",
         "Employees, Employee list: search by name, EMP number or mobile; filter by department, store, status, employment or a flag (documents missing, on probation, leaving, left, on leave today, open violation); tap a column title to sort; export CSV. Phones show one card per person.",
         "Open a file: the header has the photo, name, EMP number, position, manager, department, store and status, with Call, WhatsApp, Upload a document, Request leave for them, Record a violation, Change status (HR manage) and Edit file. The bar below says how complete the file is and lists exactly what is missing; tap an item to fix it.",
         "File tabs: Overview, Job (where they work now, the form, and the history of moves), Pay (with the salaries switch), Documents, Attendance (today's punches and the last 30 days), Leave (balances and requests), Violations, Checklists, Team, History. The tab stays in the address, so a link opens the same tab.",
         "Documents: upload a photo or PDF per required type; a new upload keeps the old one as a version. Verify what people sent from My HR, or refuse it with a note.",
         "Org chart: by manager or by department; dashed cards are open places. Export PNG or print for the wall.",
         "Configuration, Organisation: departments as a tree on the left (fold or unfold, head, headcount); pick one to see its positions with grade range, planned against in post and leave days; All positions and Grades are tabs. Add or Edit opens a side panel.",
         "Configuration, Attendance setup: Shifts and Official holidays on one page. Leave types, Violation types, Document types (which documents each file needs) and Checklist templates (tasks when someone joins or leaves) sit in the same menu."],
       "check": [
         "The HR home has nothing in red at the end of the day; every file shows 100% complete, a position, a grade and a manager; the org chart has one person at the top."],
       "problems": [
         "Manager loop refused: someone would manage themselves through the chain; set the manager on the file instead.",
         "A person is missing from payroll: open their Pay tab and set the package.",
         "An old link to Departments, Positions, Grades, Shifts or Holidays opens the new setup page on the right tab."]},
      {"title": "Hiring and leaving (HR)",
       "steps": [
         "New hire (HR home or Employee list): fill Person, Job, Pay (only with the salaries switch), Documents, System access, then Review. Every Next saves a draft; Save and finish later keeps it under Hires to finish on the HR home.",
         "Documents step: drop several files at once or take photos with the phone, then tap the type of each from the list of what this job needs. Anything missing can come later.",
         "System access: give a login (the job role comes from the position; pick the stores) or no login for people who never use the system. Riders always get a login.",
         "Create: copy the one time setup link at once and send it to the person; they open it to choose their password. Lost it? Their file shows Waiting for their password with New setup link.",
         "Someone leaving: on the file, Start leaving. Pick the last working day and the reason, the notice date, tick the company items returned, read the settlement figures for payroll, give their people, department, merchants and deals to someone (or later), then Confirm.",
         "Their account closes by itself at the end of the last day. Anything left for later shows under Needs a new owner on the HR home; give each one an owner.",
         "Documents: on a file tap Remind on a missing or expiring document (or Remind of everything missing); the person gets a notification and a notice in My HR, once a day. Documents, Expiry calendar shows what runs out each day of the month."],
       "check": [
         "No hire waits under Hires to finish for more than a day; Needs a new owner is empty; every new hire opened their setup link within the week."],
       "problems": [
         "The pay step is missing: you do not have the salaries switch; the HR manager adds the package (New hires wait for pay on the HR home).",
         "Only someone with settings manage can give the Owner job role; ask them, or pick another role.",
         "Email or mobile already used: the person may already have an account; search the employee list first.",
         "The leaving wizard refuses the last owner: give settings manage to someone else first."]},
      {"title": "Users and settings",
       "steps": [
         "Users: create team members with a job role (it fills their access per app and the stores they cover), riders (store and badge) and merchant owners; adjust a person's access from Edit (nobody changes their own) and add their Slack member ID.",
         "Settings: SLA minutes, capacity, fees, refill levels and ticket answer times."],
       "check": [
         "The audit log shows every change with who made it."],
       "problems": [
         "Someone leaves: disable the user the same day; they are signed out everywhere."]}
    ]}
}

AR = {
  "store_staff": {
    "title": "موظفين الدارك ستور",
    "who": "الاستلام والتجهيز والتغليف جوه الدارك ستور أو المركز. فرعك بيتفتح من الرئيسية بعد ما تدخل.",
    "day": [
      "أول الشيفت (أول 10 دقايق): ادخل، افتح فرعك، اقرا الطلبات (الأحمر متأخر)، اتأكد الاسكانر بيقرا، وبص على عدد الاستلام والتخزين.",
      "كل ساعة: الطلبات الأول دايما. بين الطلبات: التخزين، بعدين المرتجعات والتحويلات، بعدين الجرد.",
      "قبل ما المندوب يمشي: كل طلب متغلف ليه صورة واتسلم بسكان الكارنيه.",
      "آخر الشيفت (آخر 15 دقيقة): استلم الفلوس من كل مندوب رجع، خزن كل اللي في الاستلام، استلم البضاعة الراجعة، واكتب تذكرة لمسؤول الشيفت اللي بعدك بأي حاجة مفتوحة."
    ],
    "escalation": [
      "طلب هيتأخر أو منتج مش على الرف: اضغط ناقص على الطلب (الأدمن بيتبلغ لوحده) وقول لمسؤول الفرع.",
      "شحنة وصلت من غير رقم شحنة من التاجر: ما تستلمهاش؛ افتح تذكرة للأدمن باسم التاجر وعدد الكراتين.",
      "الفلوس مش مظبوطة: اكتب اللي عديته؛ الماليات بتراجع. ما تغيرش العد.",
      "الاسكانر أو الموبايل أو النت واقف أكتر من 10 دقايق: كلم مسؤول الفرع؛ هو يفتح تذكرة عاجلة للأدمن.",
      "أي حاجة مش متأكد منها: تذكرة لمسؤول الفرع قبل ما تتصرف."
    ],
    "sections": [
      {"title": "تسجيل الحضور والانصراف",
       "steps": [
         "وانت في المخزن افتح الصفحة الرئيسية للمخزن واضغط تسجيل حضور فوق. اسمح باللوكيشن لما الموبايل يسأل.",
         "لازم موبايلك يكون جوه المخزن (في حدود 150 متر) والـ GPS شغال؛ الكارت بيوريك وقت حضورك ولو اتأخرت.",
         "آخر الوردية اضغط تسجيل انصراف وانت في المخزن برضه."],
       "check": [
         "الكارت مكتوب فيه وقت حضورك؛ وملفي من قائمة الإعدادات بيوريك الشهر كله."],
       "problems": [
         "بعيد أو المكان مش دقيق: اطلع برة أو قرب من شباك وشغّل الـ GPS وجرب تاني.",
         "اللوكيشن مقفول: افتحه للموقع من إعدادات المتصفح.",
         "الموبايل فاصل أو نسيته: قول لمسؤول المخزن؛ الموارد البشرية تضيف التسجيل بسبب. لو نسيت الانصراف اليوم بيتقفل على نهاية ورديتك ويتعلّم."]},
      {"title": "استلام شحنة تاجر",
       "steps": [
         "اطلب من السواق رقم شحنة التاجر. لو مفيش شحنة للتاجر ده في الاستلام يبقى مفيش استلام: كلم الأدمن.",
         "افتح الاستلام واختار الشحنة. اتأكد إن اسم التاجر نفس اللي على الكراتين.",
         "افتح كرتونة كرتونة. اعمل سكان لكل قطعة. كل سكان بيزود 1 في رف الاستلام.",
         "التالف من الوصول: حطه على جنب؛ بعد القفل بلغ عنه من التالف والمحجوز بسبب وصل تالف.",
         "لما كل الكراتين تفضى اضغط اقفل الشحنة وأكد."],
       "check": [
         "الشاشة بتوري المستلم قصاد المتوقع لكل منتج.",
         "شريط حالة الشحنة بيقول اتستلم.",
         "رف الاستلام زاد باللي عملت له سكان (التخزين بيوريه)."],
       "problems": [
         "باركود اترفض (مش في الكتالوج): حط القطعة على جنب، صور الليبل، وافتح تذكرة للأدمن باسم التاجر.",
         "قطع أكتر من المتوقع: استلمها عادي؛ التاجر بيشوفها زيادة.",
         "قفلت بالغلط: بلغ الأدمن بتذكرة فورا؛ ما تستلمش الباقي على شحنة تانية."]},
      {"title": "التخزين على الرفوف",
       "steps": [
         "افتح التخزين. خد القطع من رف الاستلام.",
         "اعمل سكان للمنتج، وبعدين سكان لليبل الرف اللي هتحطه عليه.",
         "كرر لحد ما رف الاستلام يفضى."],
       "check": [
         "التخزين في الرئيسية بيقول 0 قطعة.",
         "المنتج على الرف اللي عملت سكان لليبله."],
       "problems": [
         "الرف مليان: استخدم الرف الفاضي اللي بعده واعمله سكان.",
         "مفيش ليبل للرف: اطبعه من ليبلات الرفوف قبل ما تحط حاجة."]},
      {"title": "تجهيز طلب",
       "steps": [
         "افتح الطلبات واضغط أول طلب (الأقدم الأول، الأحمر متأخر). اضغط اقبل لو جديد.",
         "روح للرف اللي ظاهر. اعمل سكان للرف (اختياري) وبعدين لكل منتج.",
         "لو منتج مش موجود اضغط ناقص. ممنوع تحط حاجة بدل حاجة."],
       "check": [
         "كل سطر المجهز بيساوي المطلوب (أو الناقص متعلم).",
         "شريط الحالة بيروح لبيتجهز، وبعد التغليف متغلف."],
       "problems": [
         "سكان لمنتج غلط: الشاشة بترفضه؛ اعمل سكان للصح.",
         "المنتج تالف على الرف: اضغط ناقص، وبلغ عنه من التالف والمحجوز بسبب تعامل الفرع."]},
      {"title": "التغليف والتسليم للمندوب",
       "steps": [
         "غلف كل الحاجات، اقفل الشنطة والزق ليبل الطلب.",
         "صور الشنطة مقفولة صورة واضحة. التغليف مش هيخلص من غيرها.",
         "لما المندوب يوصل اعمل سكان لكارنيهه.",
         "سلمه الشنط وقول عددها بصوت عالي."],
       "check": [
         "شريط الحالة بيقول خرج للتوصيل.",
         "شاشة المندوب بتوري الطلب بعدد القطع الصح."],
       "problems": [
         "الشاشة رفضت تضيف طلب لمشوار المندوب: فيه طلب هيتأخر؛ اديه لمندوب تاني.",
         "اتعمل سكان لكارنيه غلط: كلم الأدمن؛ ما تخليش المندوب يمشي بالطلب."]},
      {"title": "فلوس المناديب",
       "steps": [
         "افتح الكاش واختار المندوب.",
         "عد الفلوس قدام المندوب مرتين.",
         "اكتب اللي عديته بالظبط واحفظ.",
         "حط الفلوس في خزنة الفرع فورا."],
       "check": [
         "التسليم بيقول مظبوط، أو مستني لو فيه فرق (الماليات بتراجع).",
         "إجمالي خزنة الفرع في الكاش زاد بالمبلغ."],
       "problems": [
         "ناقص أو زيادة: احفظ العد الحقيقي، اكتب ملاحظة (المندوب قال إيه)، والفرق بيروح للماليات.",
         "المندوب مش عايز يستنى العد: ما تحفظش؛ قول لمسؤول الفرع."]},
      {"title": "التوصيل اللي فشل ومرتجعات التجار",
       "steps": [
         "لما المندوب يرجع بالبضاعة: افتح الطلب واضغط استلام البضاعة الراجعة.",
         "مرتجع تاجر: افتح المرتجعات، اختار المرتجع، اعمل سكان لكل قطعة.",
         "لما يبقى جاهز سلمه لسواق التاجر واكتب اسمه كامل."],
       "check": [
         "الطلب بيوري إن البضاعة رجعت؛ المرتجع بيقول اتسلم."],
       "problems": [
         "البضاعة ما رجعتش خلال ساعتين من المحاولة الفاشلة: الأدمن بيتبلغ؛ دور على المندوب واسأله."]},
      {"title": "التالف والجرد والتحويلات",
       "steps": [
         "التالف: افتح التالف والمحجوز، اعمل سكان للقطعة، اختار السبب، احفظ.",
         "الجرد: افتح الجرد، اعمل سكان للرف، اعمل سكان لكل قطعة بتلاقيها؛ مش هتشوف العدد المتوقع.",
         "تحويل هيتبعت: افتح التحويلات، جهز بالسكان، اضغط ابعت.",
         "تحويل وصل: اعمل سكان لكل قطعة في الاستلام، اقفله، وبعدين خزن عادي."],
       "check": [
         "القطع التالفة مبقتش معروضة للبيع.",
         "الجرد بيقول اتبعت؛ الأدمن بيوافق على الفروق.",
         "شريط حالة التحويل بيقول في الطريق (اتبعت) أو اتستلم."],
       "problems": [
         "قطع التحويل مش لاقيها: ابعت اللي عندك؛ الناقص بيتفك والأدمن بيتبلغ."]},
      {"title": "مواد التغليف (أكياس وعلب وملصقات)",
       "steps": [
         "وانت بتغلف، اختار مقاس العلبة لو استخدمت علبة من علبنا؛ الكيس والملصق والشريط اللي في الوصفة بيتخصموا لوحدهم.",
         "استخدم بس اللي في الوصفة للتاجر ده؛ لو الطلب احتاج أكتر، قول لمسؤول الفرع.",
         "مرة في الأسبوع (أو لما الأدمن يطلب)، اجرد مواد التغليف: المخزون، التغليف، جرد، اختار الصنف واكتب العدد اللي على الرف."],
       "check": [
         "بعد التغليف، مخزون التغليف في الفرع قل باللي الطلب استخدمه.",
         "الجرد بيبين الرقم اللي كتبته."],
       "problems": [
         "الشاشة بتقول إن مواد التغليف خلصت: غلف باللي عندك وقول لمسؤول الفرع؛ الأدمن بيتبلغ.",
         "مواد التغليف قربت تخلص (تنبيه): مسؤول الفرع يطلب من الحسابات أمر شراء."]}
    ]},
  "rider": {
    "title": "المندوب",
    "who": "المناديب اللي بيوصلوا طلبات الـ60 دقيقة من دارك ستور واحد.",
    "day": [
      "أول الشيفت: ادخل، اسمح بالموقع، اتأكد إن شحن الموبايل فوق 50% ومعاك فكة للطلبات الكاش.",
      "كل مشوار: خد الطلبات بسكان الكارنيه في الفرع بس؛ اتأكد من عدد الشنط.",
      "بعد كل مشوار: ارجع الفرع، رجع البضاعة اللي ما اتسلمتش، وسلم الفلوس لو مسؤولك طلب.",
      "آخر الشيفت: سلم كل الفلوس للفرع وشوفهم وهم بيعدوها. مفيش حاجة تبات معاك."
    ],
    "escalation": [
      "العميل ما بيردش بعد المكالمات اللي التطبيق بيطلبها: علمه فشل بصورة الباب؛ مسؤول الفرع بيقرر الخطوة الجاية.",
      "حادثة أو بوليس أو خطر: وقف، خليك في أمان، وكلم مسؤول الفرع فورا.",
      "حصلت مبلغ غلط: اكتب اللي أخدته بالظبط؛ الماليات هتراجع.",
      "التطبيق واقف: كلم مسؤول الفرع؛ ما تسلمش شنطة من غير الكود أو صورة."
    ],
    "sections": [
      {"title": "تسجيل الحضور والانصراف",
       "steps": [
         "وانت في المخزن افتح تطبيق المندوب واضغط تسجيل حضور فوق. اسمح باللوكيشن لما الموبايل يسأل.",
         "لازم تكون في المخزن (في حدود 150 متر) والـ GPS شغال.",
         "لما ورديتك تخلص وتسلم الكاش، اضغط تسجيل انصراف في المخزن."],
       "check": [
         "الكارت مكتوب فيه وقت حضورك."],
       "problems": [
         "المخزن قالك إنك مش مسجل حضور وهو بيسلمك طلب: سجل حضور الأول (فيه مخازن بتطلبه).",
         "بعيد أو المكان مش دقيق: روح المخزن وشغّل الـ GPS وجرب تاني؛ لو لسه مش شغال كلّم مسؤول المخزن."]},
      {"title": "توصيل طلب",
       "steps": [
         "افتح الطلب واضغط الاتجاهات.",
         "عند العنوان، كلم العميل من التطبيق لو مش لاقي المكان.",
         "اطلب كود العميل الأربع أرقام واكتبه، أو صور صورة التسليم.",
         "طلب كاش: خد المبلغ اللي ظاهر بالظبط، اكتب اللي أخدته، واضغط اتسلم."],
       "check": [
         "الطلب بيروح لخلصت النهارده كاتسلم.",
         "إجمالي كاش النهارده زاد بالمبلغ."],
       "problems": [
         "الكود غلط: راجعه مع العميل؛ عمرك ما تسلم من غير الكود أو صورة.",
         "العميل معهوش فكة: ما تديش فكة من فلوس الشركة؛ كلم مسؤول الفرع."]},
      {"title": "لو مقدرتش توصل",
       "steps": [
         "العميل ما بيردش: اتصل من التطبيق عدد المرات اللي بيطلبها، وبعدين صور الباب.",
         "اضغط مقدرتش أوصل، اختار السبب، واكتب التفاصيل لو سبب تاني.",
         "رجع البضاعة للفرع في نفس المشوار."],
       "check": [
         "الطلب بيقول محاولة فشلت أو فشل.",
         "الموظف ضغط استلام البضاعة الراجعة."],
       "problems": [
         "مش قادر ترجع الفرع: كلم مسؤول الفرع؛ ممنوع تبات بالبضاعة."]},
      {"title": "الفلوس آخر الشيفت",
       "steps": [
         "روح الفرع بكل الفلوس اللي حصلتها.",
         "سلمها وشوفهم وهم بيعدوها.",
         "اتأكد إن المعدود نفس إجمالي النهارده في تطبيقك."],
       "check": [
         "شاشة الفرع بتقول مظبوط."],
       "problems": [
         "فيه فرق: قول للموظف اللي حصل عشان يكتبه في الملاحظة؛ الماليات بتقرر."]}
    ]},
  "merchant": {
    "title": "التاجر",
    "who": "المحلات اللي بتبيع بتوصيل شيبلي ناو في 60 دقيقة.",
    "day": [
      "كل صباح: بص على الطلبات والإشعارات؛ وشوف المنتجات اللي قربت تخلص.",
      "قبل ما تبعت بضاعة: اعمل الشحنة الأول، وبعدين ابعت.",
      "كل أسبوع: راجع المحفظة وكشف الحساب؛ واتأكد إن مواعيد التحويل صح."
    ],
    "escalation": [
      "سؤال عن طلب أو فلوس: كلم دعم شيبلي (مدير حسابك) برقم الطلب أو التحويل.",
      "حاجة ناقصة بعد استلام شحنة: ابعت رقم الشحنة وكود المنتج خلال 48 ساعة."
    ],
    "sections": [
      {"title": "ابدأ البيع",
       "steps": [
         "ضيف منتجاتك (واحد واحد، بملف، أو بربط متجر شوبيفاي). كل منتج محتاج باركود.",
         "حدد سعر توصيل الـ60 دقيقة من التوصيل.",
         "اعمل أول شحنة عشان نستلم البضاعة."],
       "check": [
         "القائمة في الرئيسية كلها متعلمة."],
       "problems": [
         "باركود اترفض: مستخدم لمنتج تاني؛ استخدم الباركود الحقيقي اللي على القطعة."]},
      {"title": "ابعت بضاعة",
       "steps": [
         "الشحنات، شحنة جديدة: اكتب كل منتج وكميته.",
         "اكتب رقم الشحنة على كل كرتونة.",
         "ابعت الكراتين للعنوان اللي ظاهر."],
       "check": [
         "الشحنة بتمشي متوقع، بيتستلم، اتستلم.",
         "بيوصلك ملخص: المتوقع قصاد المستلم."],
       "problems": [
         "قطع زيادة: بتتستلم وبتظهر زيادة؛ مفيش حاجة تعملها."]},
      {"title": "الطلبات والفلوس",
       "steps": [
         "طلبات شوبيفاي اللي فيها الـ60 دقيقة بتيجي لوحدها؛ وتقدر تضيف طلب من طلب جديد: دوّر على حي العميل، ولو تعرف العمارة حط علامة على الخريطة. الفورم بيقولك على طول إذا كان الفرع يقدر ياخده.",
         "تقدر تلغي الطلبات الجديدة أو المقبولة بس.",
         "المحفظة بتوري لك عندنا كام؛ التحويلات بتنزل البنك على مواعيدك.",
         "العقد بيوريك اتفاقك مع شيبلي: كل سعر جنب السعر القياسي (غالبا رسوم شحن واحدة لكل شحنة متسلمة شاملة الباقي)، وسعر أي منتج لو ليه سعر، وتكلفة التوصيل الفاشل، وجرب الحاسبة بمنتجاتك، وشرائح الحجم، وشروط الدفع، والالتزامات والتواريخ. نزله PDF عربي أو إنجليزي؛ والإصدارات القديمة موجودة في الإصدارات."],
       "check": [
         "كل تحويل ليه رقم مرجع من البنك.",
         "الرسوم في كشف حسابك مطابقة لأسعار إصدار العقد الساري في اليوم ده."],
       "problems": [
         "تحويل شكله غلط: نزل كشف الحساب للفترة وابعته مع سؤالك."]},
      {"title": "فريقك",
       "steps": [
         "المالك يفتح الفريق ويضيف الناس اللي بتشتغل على الحساب: الاسم والإيميل وكلمة السر، ومالك ولا عضو.",
         "العضو بياخد الصلاحيات اللي إنت بتعلّم عليها بس: الطلبات، البضاعة، الفلوس، الإعدادات.",
         "حد ساب الشغل: أوقفه في نفس اليوم؛ هيتعمله خروج من كل الأجهزة."],
       "check": [
         "العضو بيشوف في القائمة الحاجات اللي ليها صلاحية بس."],
       "problems": [
         "مينفعش تنزّل دورك أو توقف نفسك، ولازم يفضل مالك واحد شغال: خلي حد تاني مالك الأول."]}
    ]},
  "finance": {
    "title": "الماليات",
    "who": "فريق الماليات والمحاسب. كل حاجة في الماليات.",
    "day": [
      "كل صباح (30 دقيقة): النظرة العامة؛ راجع كل فرق نقدية في الكاش؛ أودع كاش امبارح في البنك (اختار البنك واكتب رقم الإيصال).",
      "أيام التحويلات: التحويلات، جهز المستحق، راجع كل واحد، حول من البنك، وعلمه اتدفع برقم المرجع.",
      "كل فاتورة أو حركة فلوس في نفس يومها: حركة الأموال، ورقم الإيصال الورق كمرجع.",
      "آخر الشهر: ميزان المراجعة، الأرباح والخسائر، الميزانية، مطابقة البنك، وملفات CSV للمحاسب."
    ],
    "escalation": [
      "مندوب ناقص أكتر من مرة في الأسبوع: تذكرة للأدمن بأرقام CH-.",
      "تحويل رجع أو رقم البنك مش مطابق: تذكرة للأدمن؛ ما تسجلش تصحيح قبل ما تعرف السبب.",
      "ميزان المراجعة مش متوازن: وقف وافتح تذكرة عاجلة للأدمن (المفروض عمرها ما تحصل)."
    ],
    "sections": [
      {"title": "مراجعة فرق نقدية",
       "steps": [
         "الكاش، مستني مراجعتك: افتح التسليم (CH-...).",
         "اقرا الملاحظة وكلم مسؤول الفرع لو محتاج.",
         "شيله على الشركة (خسارة) أو سيبه على المندوب، ودايما بسبب."],
       "check": [
         "التسليم بيخرج من قائمة الانتظار؛ كاش المندوب في المناديب صح."],
       "problems": [
         "مش متأكد مين الصح: تذكرة لمسؤول الفرع؛ قرر بعد الرد."]},
      {"title": "إيداع كاش الفرع في البنك",
       "steps": [
         "الكاش، الفرع، اكتب المبلغ ورقم إيصال البنك، اختار البنك، أودع.",
         "احتفظ بالإيصال واكتب عليه رقم القيد JV."],
       "check": [
         "خزنة الفرع بتقل وحساب البنك (دليل الحسابات) بيزيد بنفس المبلغ."],
       "problems": [
         "أودعت في بنك غلط: اعمل تحويل بين البنكين بالسبب؛ ممنوع المسح."]},
      {"title": "تسجيل حركة الأموال",
       "steps": [
         "تحويل: من بنك أو خزنة لتانية.",
         "مصروف: اختار النوع ودفعت منين؛ واكتب الضريبة لو في الفاتورة.",
         "فلوس المالك: رأس مال داخل أو مسحوبات طالعة.",
         "قيد يومية: تصحيحات بسبب مكتوب. المدين لازم يساوي الدائن."],
       "check": [
         "بتاخد رقم قيد (JV-...). اكتبه على الإيصال واحفظه.",
         "كشف الحساب بيوري السطر والرصيد بعده صح."],
       "problems": [
         "مفيش فلوس كفاية في الحساب: الشاشة بترفض؛ راجع التاريخ والحساب."]},
      {"title": "تحويلات التجار",
       "steps": [
         "التحويلات، جهز التحويلات المستحقة لليوم.",
         "افتح كل مسودة (PAY-...) وقارنها بكشف حساب التاجر.",
         "نزل ملف التحويل البنكي من أعلى التحويلات وارفعه في التحويل الجماعي في CIB (التجار اللي ملهمش حساب بنكي بيظهروا؛ بيكتبوه في المحفظة).",
         "بعد تأكيد البنك، علمه اتدفع برقم المرجع والبنك اللي دفعت منه."],
       "check": [
         "التحويل بيقول اتدفع؛ رصيد التاجر قل بالمبلغ."],
       "problems": [
         "المبلغ شكله غلط: الغي المسودة بملاحظة وافتح تذكرة للأدمن.",
         "تاجر اتساب برسالة below_payout_minimum: المستحق له أقل من الحد الأدنى للتحويل في عقده (أو إعداد الحد الأدنى في الحسابات)؛ بيستنى لحد ما الرصيد يوصله."]},
      {"title": "الموافقات والإيصالات",
       "steps": [
         "الموافقات: كل فلوس داخلة، وكل فلوس خارجة من حد الموافقة، بتستنى هنا شخص تاني.",
         "افتح كل واحدة، راجع الإيصال أو إشعار البنك، ووافق أو ارفض بسبب. ما ينفعش توافق على طلبك.",
         "الإيصالات: ارفع صورة الإيصال الورق أو إشعار التحويل لكل حركة في القائمة."],
       "check": [
         "اللي اتوافق عليه بياخد رقم JV؛ قائمة الإيصالات بتقل كل يوم."],
       "problems": [
         "فيه طلب مستني إنت ما طلبتوش: ارفضه وافتح تذكرة عاجلة للأدمن."]},
      {"title": "قفل الشهر",
       "steps": [
         "بعد ما مراجعات آخر الشهر تمشي صح، اقفل الدفاتر لحد آخر يوم في الشهر.",
         "مفيش تسجيل قبل اليوم ده تاني؛ اللي بيدير الإعدادات بس (المالك) يفتح، بسبب مكتوب."],
       "check": [
         "شاشة قفل الدفاتر بتبين اليوم الجديد."],
       "problems": [
         "فاتورة متأخرة لشهر مقفول: سجلها النهارده بملاحظة؛ اسأل الأدمن بس لو لازم تتسجل في الشهر القديم."]},
      {"title": "المرتبات والسلف",
       "steps": [
         "المرتبات: الموارد البشرية بتحدد كل شخص موظف ولا عمالة خارجية (وشركته) وحزمة مرتبه (الأساسي والبدلات من تاريخ معين). شاشة المرتبات بتعرضهم للقراءة بس؛ أي تغيير اطلبه من الموارد البشرية.",
         "سلفة: اختار الشخص والمبلغ والبنك أو الخزنة اللي هتدفع منها.",
         "آخر الشهر: اختار الشهر والبنك، اكتب المكافآت والخصومات والسلف المستردة، راجع المرتبات (الضريبة والتأمينات وصندوق الشهداء لكل شخص)، وادفع؛ واطبع القسائم.",
         "العمالة الخارجية: سجل فاتورة شركتهم الشهرية لكل شخص في الموردون والفواتير؛ استرد السلف وإنت بتدفع الفاتورة؛ وادفع مكافآتهم من هنا.",
         "كل شهر سدد ضريبة كسب العمل والتأمينات وصندوق الشهداء من الضرائب."],
       "check": [
         "السلفة المستحقة على كل واحد بتقل؛ المرتبات بتظهر في الموافقات لو فوق الحد."],
       "problems": [
         "حد مش ظاهر في المرتبات: الموارد البشرية لسه ما حددتش حزمة مرتبه؛ ابعت تذكرة لمدير الموارد البشرية."]},
      {"title": "فواتير الموردين",
       "steps": [
         "الموردون والفواتير: ضيف المورد مرة واحدة برقمه الضريبي ونسبة الخصم من المنبع (اسأل المحاسب).",
         "فاتورة جديدة يوم ما توصل: المورد، رقم فاتورته، التواريخ، البند، المخزن، المبلغ قبل الضريبة والضريبة.",
         "للسداد: افتح الفاتورة، اكتب المبلغ والبنك ومرجع التحويل. الخصم من المنبع بيتحجز لوحده.",
         "بص على المستحق حسب التأخير كل أسبوع؛ ادفع العواميد الحمرا الأول."],
       "check": [
         "الفاتورة المدفوعة بتخرج من الفواتير المفتوحة؛ المستحق للمورد بيبقى صفر."],
       "problems": [
         "فاتورة اتسجلت مرتين أو غلط: إلغاء الفاتورة بسبب (قبل أي سداد بس)."]},
      {"title": "الضرائب",
       "steps": [
         "الضرائب بتبين القيمة المضافة والخصم من المنبع المستحقين النهارده.",
         "كل ربع سنة: افتح الربع، ادي القائمة للمحاسب لنموذج 41، وبعدين سداد ضريبة (خصم من المنبع) بالإجمالي.",
         "كل شهر: الإقرارات الضريبية فيها خانات إقرار القيمة المضافة؛ بعد ما المحاسب يقدمه، سداد ضريبة (قيمة مضافة) بالمبلغ المقدم.",
         "كل شهر: الإقرارات الضريبية فيها قوائم ضريبة المرتبات والتأمينات (CSV)؛ سدد الاتنين من الضرائب.",
         "كل ربع سنة: الإقرارات الضريبية، نزل ملف نموذج 41 وارفعه على بوابة الضرائب.",
         "بعد نهاية السنة: الإقرارات الضريبية، ضريبة الدخل؛ سجل المبلغ المتفق عليه مع المحاسب قبل إقفال السنة."],
       "check": [
         "المستحق بيقل بقد اللي دفعته."],
       "problems": [
         "مورد من غير رقم ضريبي: ضيفه في بيانات المورد قبل التقديم."]},
      {"title": "المتكرر والمدفوع مقدما والمعدات",
       "steps": [
         "المصروفات المتكررة: الإيجار والإنترنت وزيهم؛ كل شهر في يومه بيستنى في الموافقات.",
         "المدفوع مقدما والمعدات: الإيجار المدفوع مقدما في دفع مقدم؛ الأرفف والتلاجات والموتوسيكلات في شراء معدات.",
         "آخر كل شهر السيستم بينقل الجزء الصح للمصروف أو الإهلاك لوحده."],
       "check": [
         "الشهور المحملة بتزيد واحد كل شهر."],
       "problems": [
         "مصروف متكرر سعره اتغير: وقف القديم وضيف واحد جديد."]},
      {"title": "تجار عليهم مستحقات",
       "steps": [
         "مستحقات على التجار بتعرض كل تاجر رسومه عدت الكاش اللي حصلناه له.",
         "كلمه، وبعدين مطالبة بالسداد (بيشوفها في لوحته).",
         "لما يحول، سجلها في التجار كتحصيل من التاجر."],
       "check": [
         "التاجر بيخرج من القائمة لما رصيده يرجع صفر أو أكتر."],
       "problems": [
         "مديون أكتر من 30 يوم: تذكرة للأدمن."]},
      {"title": "مطابقة البنك",
       "steps": [
         "كل أسبوع: نزل كشف الحساب من الإنترنت البنكي لـ CIB إكسل (.xlsx) أو CSV.",
         "مطابقة البنك، اختار البنك والملف؛ راجع الأعمدة اللي اختارها وأول السطور، وبعدين استيراد الكشف.",
         "في البنك ومش في الدفاتر: مصاريف البنك اضغط سجل كمصاريف بنكية؛ الفلوس الداخلة تتسجل الأول تحصيل من تاجر أو رأس مال؛ غلطة البنك تتستبعد بسبب.",
         "في الدفاتر ومش في البنك: اعرف السبب (إيداع ما اتعملش، شيك ما اتصرفش)."],
       "check": [
         "القائمتين فاضيين والفرق مكتوب مطابق."],
       "problems": [
         "قيد في الدفاتر ما وصلش البنك بعد أسبوع: تذكرة عاجلة للأدمن برقم JV."]},
      {"title": "القيمة المضافة والموازنات والكاش",
       "steps": [
         "تقرير القيمة المضافة: كل شهر ادي المحاسب سطر الشهر للإقرار، وبعدين سجل السداد في الضرائب.",
         "الموازنات: قبل كل شهر اكتب الموازنة لكل حساب (لكل مخزن أو للشركة)؛ بص على أفضل أو أسوأ كل أسبوع.",
         "التدفق النقدي: اقرا الأربع أسابيع الجاية كل يوم اتنين؛ لو الفلوس هتخلص بلغ الأدمن في نفس اليوم."],
       "check": [
         "آخر أسبوع في التوقع بيخلص فوق الصفر."],
       "problems": [
         "مصروف أعلى بكتير من الموازنة: تذكرة للأدمن بالحساب والمبلغ."]},
      {"title": "نهاية السنة والتصدير",
       "steps": [
         "في يناير بعد مراجعات ديسمبر: نهاية السنة والتصدير، إقفال السنة للسنة اللي فاتت (للموافقين بس).",
         "للمحاسب: اختار الأيام ونزل اليومية (CSV)؛ بتتستورد في أودو وزوهو بوكس وكويك بوكس ودفترة.",
         "للمراجع: نزل حزمة المراجعة (zip) فيها اليومية وميزان المراجعة ودليل الحسابات والقيمة المضافة وصور الإيصالات."],
       "check": [
         "السنة مكتوب عليها مقفلة برقم JV؛ أرباح وخسائر السنة اللي فاتت لسه زي ما هي."],
       "problems": [
         "أقفل السنة السابقة الأول: أقفل السنين بالترتيب من الأقدم."]},
      {"title": "الفواتير الضريبية ومنظومة الفاتورة الإلكترونية",
       "steps": [
         "أول أيام كل شهر: الفواتير الضريبية، اختار الشهر اللي فات، إصدار فواتير الشهر.",
         "على جهاز الماليات وفيه فلاشة التوقيع: شغل برنامج التوقيع (docs/ETA.md)؛ بيوقع ويبعت كل الفواتير المستنية.",
         "اتأكد إن كل فاتورة بقت صحيحة؛ افتح المرفوضة أو غير الصحيحة، صلح السبب المكتوب واضغط إرسال مرة أخرى.",
         "رد رسوم: افتح الفاتورة، إشعار دائن بالمبلغ والسبب؛ شخص تاني يوافق."],
       "check": [
         "كل فواتير الشهر صحيحة؛ التجار بيشوفوها في الفواتير."],
       "problems": [
         "برنامج التوقيع طلع خطأ: ابعت الرسالة للأدمن؛ ما تعملش الفواتير تاني."]},
      {"title": "الفواتير بالعملة الأجنبية والمعدات والاستحقاقات",
       "steps": [
         "فاتورة بالدولار أو عملة تانية: اختار العملة وسعر الفاتورة؛ وانت بتدفع اكتب المبلغ بالعملة وسعر النهارده. الفرق بيروح لفروق العملة لوحده.",
         "معدات اتباعت أو اتكهنت: مدفوع مقدما ومعدات، بيع أو تكهين، بالسعر (0 لو تكهين) والسبب؛ شخص تاني يوافق.",
         "مصروف الشهر ده وفاتورته جاية بعدين: قيد يومية مع عكس أول الشهر الجاي."],
       "check": [
         "المعدات المباعة مكتوب عليها مباعة أو مكهنة ووقف إهلاكها."],
       "problems": [
         "سعر غلط في فاتورة: ألغي الفاتورة (قبل الدفع) وسجلها تاني."]},
      {"title": "الشيكات",
       "steps": [
         "الشيكات، تسجيل شيك: اختار مستلم أو صادر والغرض (رصيد تاجر، تأمين، مورد بيرجع فلوس، إيرادات تانية؛ أو فاتورة، دفعة تاجر، رد تأمين)، واكتب رقم الشيك والبنك والمبلغ وتاريخ الإصدار والاستحقاق، وارفع صورة الشيك.",
         "الشيك اللي بيجيلنا دايما يستنى موافقة شخص تاني في الموافقات؛ والشيك اللي بنكتبه يستنى من حد الموافقة. لحد كده بيظهر في انتظار الموافقة.",
         "كل صبح بص على قائمة الاستحقاق: المتأخر الأول. إيداع بالبنك لما تسلم الشيك للبنك، ودفعه البنك لما الفلوس تظهر في الكشف (مش قبل يوم استحقاقه).",
         "شيك رجع من غير ما يتصرف: ارتد مع سبب البنك. المديونية بترجع على التاجر أو المورد أو الفاتورة، والدفعة اللي اتدفعت بيه بتتلغي، والإدارة بيوصلها تنبيه."],
       "check": [
         "شيكات تحت التحصيل (1151) بتساوي الشيكات المستلمة اللي لسه ما اتحصلتش؛ وشيكات مستحقة الدفع (2451) بتساوي الصادرة اللي البنك لسه ما دفعهاش."],
       "problems": [
         "مبلغ أو طرف غلط: إلغاء الشيك مع السبب (قبل الإيداع أو التحصيل بس)، وسجله تاني.",
         "الفاتورة اتدفع جزء منها في النص والشيك مبقاش مناسب: ألغيه واكتب شيك جديد."]},
      {"title": "عقود التجار والتأمينات والربحية",
       "steps": [
         "عقود التجار: اقرا إصدار العقد الساري لكل تاجر والتأمين اللي معانا ورصيده مقارنة بحد الائتمان؛ واسم التاجر بيفتح العقد كله (الأسعار والشرائح وشروط الدفع) في التجار.",
         "التأمين: التأمين في صف التاجر، استلام أو رد، عن طريق البنك أو رصيد التاجر؛ شخص تاني يوافق.",
         "الحد الأدنى الشهري بيتكمل لوحده يوم 1 للشهر اللي فات (استكمال الحد الأدنى الشهري في اليومية وفي الفاتورة).",
         "الربح لكل تاجر: افتح شهر، وبعدين تاجر تشوف الرسوم حسب النوع والتكاليف والهامش لكل طلب؛ واستخدم ماذا لو تجرب رسوم تانية على نفس الشهر قبل ما تكلم التاجر."],
       "check": [
         "التأمينات المحتفظ بيها (محافظ 2600) مطابقة للعقود الموقعة؛ ومفيش تاجر متجاوز الحد من غير تذكرة مفتوحة مع مدير حسابه."],
       "problems": [
         "تاجر متجاوز حد الائتمان ومش قادر يبعت شحنات: اطلب منه يدفع، وسجل التحصيل، والشحنات بتفتح تاني على طول."]},
      {"title": "آخر الشهر",
       "steps": [
         "ميزان المراجعة للشهر: المدين لازم يساوي الدائن.",
         "الأرباح والخسائر للشهر؛ والميزانية في آخر يوم.",
         "قارن كشف كل حساب بنكي في شيبلي بكشف البنك الحقيقي؛ وسجل مصاريف البنك كمصروف في 5501.",
         "نزل اليومية والكشوف CSV للمحاسب."],
       "check": [
         "أرصدة البنوك في شيبلي = كشوف البنك.",
         "الميزانية بتقول الأصول = الخصوم + حقوق الملكية."],
       "problems": [
         "فرق مش عارف تفسره: تذكرة للأدمن بكود الحساب والمبلغ."]},
      {"title": "أوامر الشراء ومواد التغليف",
       "steps": [
         "الحسابات، الموردين، أوامر الشراء: اختار المورد والفرع (لازم للتغليف)، ضيف السطور (صنف تغليف أو بند مصروف، الكمية، سعر الوحدة) وارفع صورة عرض السعر.",
         "تحت حد الاعتماد بيتعتمد على طول؛ فوقه شخص تاني عنده صلاحية الاعتماد بيعتمده.",
         "سجل إنه اتبعت للمورد. لما البضاعة توصل، اكتب اللي وصل على الأمر (ممكن على دفعات): مواد التغليف بتدخل مخزون الفرع.",
         "لما فاتورة المورد توصل، سجل الفاتورة على الأمر برقم فاتورتهم؛ وبعدين ادفعها من الفواتير زي العادي.",
         "اقفل الأمر لما يكمل، أو لما المورد مش هيبعت الباقي (مع ملاحظة).",
         "مواد تغليف اتشرت من محل واتدفعت على طول: المخزون، التغليف، شراء ودفع الآن، مع صورة الإيصال."],
       "check": [
         "شريط حالة الأمر بيقول تمت الفوترة أو مغلق وفاتورته ظاهرة في الفواتير.",
         "قيمة مخزون التغليف (المخزون، التغليف) = حساب 1402 في ميزان المراجعة؛ و2401 صفر لما كل المستلم يتفوتر."],
       "problems": [
         "الفاتورة مرفوضة لأنها أعلى من الأمر: راجع أسعار المورد؛ اطلب من الأدمن يغير finance.po_bill_tolerance_bp بس لو ده متفق عليه.",
         "وصلت بضاعة مش متطلبة: متستلمهاش على الأمر؛ افتح أمر شراء جديد."]},
      {"title": "رسائل البريد للتجار",
       "steps": [
         "لما تسجل دفعة إنها اتدفعت، التاجر بيوصله إشعار الدفعة وكشف حساب الفترة مع ملف CSV؛ ولما تصدر فواتير الشهر، كل تاجر بيوصله رابط يطبع فاتورته.",
         "الحسابات، التجار، رسائل البريد للتجار بتبين كل رسالة: في الانتظار، أُرسلت، أو فشلت. افتح معاينة تشوفها زي التاجر.",
         "رسالة فشلت: راجع العنوان مع التاجر (بيغيره من المحفظة)، وبعدين اضغط أرسل مرة أخرى."],
       "check": [
         "بعد الدفعة، رسالتين للتاجر بيبقوا أُرسلت خلال دقيقة."],
       "problems": [
         "الصفحة بتقول البريد غير مُعد: بلغ الأدمن؛ الرسائل بتستنى لحد ما SMTP يتعمل.",
         "تاجر بيقول الرسالة موصلتلوش: اتأكد إنها أُرسلت، واطلب منه يدور في الرسائل المزعجة."]}
    ]},
  "admin": {
    "title": "الأدمن",
    "who": "فريق تشغيل الشغل. الرئيسية بتبين التطبيقات اللي وظيفتك بتفتحها؛ المالك بيفتح كل حاجة.",
    "day": [
      "كل صباح: النظرة العامة، بعدين التنبيهات (اتعامل مع كل واحد)، بعدين التذاكر (ليا).",
      "كل ساعة وقت الذروة: الطلبات، المتأخر الأول؛ كلم مسؤول أي فرع أحمر.",
      "كل ليلة بعد 9: التحويلات، وافق أو عدل مسودات إعادة التعبئة.",
      "كل أسبوع: التجار (التسجيلات)، الجرد (وافق على الفروق)، التالف (سوي)، الإعدادات (اتأكد مفيش تغيير بالغلط)."
    ],
    "escalation": [
      "بيوصلك اللي محدش تاني يقدر يقرره: نقص مخزون، فروق فلوس، شكاوى تجار، أجهزة بايظة.",
      "استخدم التذاكر عشان تسأل أي حد؛ كل تذكرة ليها وقت رد وتذكير.",
      "شوبيفاي أو الدفع أو السيرفر واقف: تذكرة عاجلة للمسؤول التقني وقول للفروع ياخدوا طلبات يدوي بس بعد ما تقول."
    ],
    "sections": [
      {"title": "الحضور والورديات",
       "steps": [
         "الموارد البشرية، الإعدادات: الورديات (البداية والنهاية والراحة والأيام) والإجازات الرسمية؛ وإعدادات الموارد البشرية فيها مسافة تسجيل الحضور والسماح والإضافي ومكان المكتب.",
         "الموارد البشرية، الحضور، جدول الورديات: حدد الوردية الأساسية لكل شخص؛ الأسبوعين الجايين بيتعملوا منها؛ وغيّر أي يوم باليد لو محتاج.",
         "الموارد البشرية، الحضور، النهارده: مين حاضر أو متأخر أو مش موجود أو في راحة في كل مخزن. أيام الحضور: الأيام المقفولة بالتأخير والإضافي والساعات وتصدير CSV.",
         "افتح اليوم علشان تصححه: ضيف تسجيل الموبايل معملوش، أو الغي تسجيل غلط، أو حدد الحالة؛ كل تصحيح لازم له سبب."],
       "check": [
         "أيام امبارح بتتقفل الصبح؛ ولو حد نسي الانصراف بتظهر العلامة."],
       "problems": [
         "حد مش عارف يسجل حضور (بعيد): راجع مخزنه في الملف ومكان المخزن و hr.clock_radius_m.",
         "موظفين المكتب مش عارفين يسجلوا: حدد hr.office_lat و hr.office_lng."]},
      {"title": "الفروع والمراكز والمناطق",
       "steps": [
         "المخازن ومراكز الفرز: افتح موقع بكود قصير (حروف وأرقام)، العنوان ومكانه على الخريطة.",
         "مناطق التوصيل: اختار الفرع، اعمل منطقة (كود وأسامي)، وبعدين اضغط على الأحياء في الخريطة عشان تضيفها؛ اضغط تاني عشان تشيلها، و\"علّمه مش بنخدمه\" لمكان مش بنروحه. \"اختار الأحياء جوه شكل\" بيضيف كتير مرة واحدة.",
         "للمراجعة: قرّر في كل حي كان متقسم بين فرعين (خليه، انقله، أو مش بنخدمه).",
         "خريطة العناوين: شغل تحميل OpenStreetMap مرة، وبعدين وافق على الأسماء اللي بتتعلمها كل أسبوع."],
       "check": [
         "جرب عنوان في خريطة العناوين: بيروح للفرع الصح."],
       "problems": [
         "حي تبع فرع تاني: لما تضغط عليه هيسألك قبل ما ينقله.",
         "طلبات بتقول address_unsure: العنوان فيه منطقة متقسمة بين فرعين؛ ضيف الأحياء الناقصة أو اطلب الحي أو علامة على الخريطة."]},
      {"title": "التجار والمنتجات وشوبيفاي",
       "steps": [
         "التجار: وافق أو ارفض التسجيلات بسبب.",
         "شوبيفاي: اربط التاجر بمتجره، ابعتله لينك التثبيت، وبعدين اعمل المواقع.",
         "المنتجات: ارفع ملف المنتجات؛ كل باركود لازم يكون مختلف."],
       "check": [
         "كارت شوبيفاي بيوري المواقع والمنتجات المربوطة."],
       "problems": [
         "تاجر نقل لمتجر شوبيفاي جديد: افصل المتجر وبعدين اربط الجديد."]},
      {"title": "عقود التجار",
       "steps": [
         "التجار: افتح التاجر؛ التبويبات: نظرة عامة، العقد، شوبيفاي، المنتجات والمخزون، المستخدمون، الربحية (مع الحسابات) والسجل.",
         "العقد، تعديل (إصدار جديد): كل سعر جنب السعر القياسي (سيبه فاضي للسعر القياسي، واكتب صفر لو مفيش رسم)، وشرائح الحجم على أي رسم (الطلبات في الشهر: من الطلب رقم n، والأسعار اللي بتتغير)، وشروط الدفع (مواعيد التحويل، الحد الأدنى للتحويل، الحد الأدنى الشهري، التأمين، حد الائتمان)، والالتزامات (مدة التوصيل، المحاولات، المخازن، المناطق)، والتواريخ والشروط الخاصة وملاحظة داخلية. حفظ المسودة مش بيغير حاجة لسه.",
         "التجار الشامل: اضغط طبق الشامل وبعدين اكتب رسوم الشحن (مثلا 120 جنيه). بيخلي رسم الطلب والدفع عند الاستلام والاستلام والتخزين والإرجاع والتغليف صفر، والتوصيل الفاشل 100% من الشحنة. التغليف علينا إلا لو كتبت رسوم تغليف.",
         "السعر لكل منتج: دور على منتجات التاجر بالرمز أو الاسم واكتب سعر القطعة، أو علّم كذا منتج واضغط حدد السعر ليهم كلهم، أو استورد CSV (sku و price_egp؛ صف واحد غلط ومفيش حاجة بتتغير). تنزيل الأسعار بيديك قائمة الإصدار المحفوظ. كل قطعة متسلمة بتتحسب بسعر منتجها؛ القطع الملغية والمنتجات اللي ملهاش سعر مش بتتحسب، والشرائح مش بتسري على الأسعار دي.",
         "التوصيل الفاشل: الرسم الثابت لو اتكتب بيتحسب زي ما هو؛ وإلا نسبة من الشحنة (رسوم الشحن وأسعار المنتجات ورسم الطلب، ومن غير الدفع عند الاستلام).",
         "راجع المسودة بالحاسبة (شحنة مثال من منتجات التاجر، نقدي أو مدفوع مقدما، وقيمتها وتكلفة المحاولة الفاشلة؛ وشهر شحنات ووحدات)، وبعدين فعلها من النهارده أو يوم بعده. الرسوم من اليوم ده بتتحسب بالإصدار الجديد؛ والإصدارات القديمة موجودة في الإصدارات وبتتطبع زي ما هي.",
         "ارفع النسخة الموقعة (PDF أو JPG أو PNG لحد 5 ميجا) في النسخ الموقعة، واطبع العقد عربي أو إنجليزي من PDF عربي / PDF English.",
         "الحساب البنكي للتحويلات بيتعدل من شروط الدفع في العقد.",
         "الشريحة بتتطبق من الطلب اللي بيعدي الحد، ومش على الطلبات اللي قبله في الشهر؛ ورسوم الوحدات والتوصيل الفاشل بتاخد شريحة الطلب الجاي."],
       "check": [
         "التاجر بيشوف العقد الساري للعرض بس تحت العقد (مع الـPDF)؛ والسجل بيوري كل مسودة وتفعيل وملف.",
         "إعدادات الرسوم في الحسابات هي الأسعار القياسية بس: سعر التاجر الخاص في عقده."],
       "problems": [
         "شحنات مرفوضة لتاجر متجاوز حد الائتمان: التنبيه فيه الرصيد؛ الحسابات تسجل الدفع أو انت ترفع الحد بموافقة المالك."]},
      {"title": "المخزون",
       "steps": [
         "الجرد: وافق أو ارفض كل فرق.",
         "التالف: أكد السبب؛ أسباب الشركة بتعوض التاجر.",
         "التحويلات: وافق، عدل الكميات، أو الغي قبل ما التجهيز يبدأ."],
       "check": [
         "المخزون في صفحة المخزون نفس اللي الموظفين شايفينه على الرفوف."],
       "problems": [
         "جرد قديم: اطلب من الفرع يجرد الرف تاني."]},
      {"title": "الأفراد (تطبيق الموارد البشرية)",
       "steps": [
         "افتح الموارد البشرية: الصفحة الرئيسية بتوريك اللي محتاجك النهارده: مين حاضر أو متأخر أو غايب أو في إجازة دلوقتي، اللي مستني في الوارد، المخالفات المقترحة، المستندات الناقصة أو اللي هتخلص، قوائم الانضمام والمغادرة، فترات الاختبار والعقود اللي بتخلص في 30 يوم، أعياد الميلاد وذكرى الشغل الأسبوع ده، وعدد الموظفين. كل كارت فيه زرار للتصرف.",
         "الموظفون، قائمة الموظفين: دوّر بالاسم أو رقم الموظف أو الموبايل؛ فلتر بالقسم أو الفرع أو الحالة أو نوع التوظيف أو علامة (مستندات ناقصة، تحت الاختبار، سيغادر، غادر، في إجازة النهارده، مخالفة مفتوحة)؛ اضغط على عنوان العمود عشان ترتب؛ وصدّر CSV. الموبايل بيعرض كارت لكل شخص.",
         "افتح الملف: الجزء العلوي فيه الصورة والاسم ورقم الموظف والوظيفة والمدير والقسم والفرع والحالة، وأزرار اتصال وواتساب ورفع مستند وطلب إجازة نيابة عنه وتسجيل مخالفة وتغيير الحالة (إدارة الموارد البشرية) وتعديل الملف. الشريط اللي تحته بيقول الملف مكتمل بنسبة كام ويعرض بالظبط الناقص؛ اضغط على أي بند عشان تكمله.",
         "تبويبات الملف: نظرة عامة، الوظيفة (فين بيشتغل دلوقتي والنموذج وسجل التنقلات)، الراتب (بصلاحية المرتبات)، المستندات، الحضور (تسجيلات النهارده وآخر 30 يوم)، الإجازات (الأرصدة والطلبات)، المخالفات، قوائم المهام، الفريق، السجل. التبويب بيفضل في العنوان، فاللينك بيفتح نفس التبويب.",
         "المستندات: ارفع صورة أو PDF لكل نوع مطلوب؛ الرفع الجديد بيحتفظ بالقديم كنسخة. اتحقق من اللي الناس بعتوه من ملفي، أو ارفضه بملاحظة.",
         "الهيكل التنظيمي: حسب المدير أو حسب القسم؛ البطاقات المنقطة أماكن شاغرة. صدّره صورة PNG أو اطبعه.",
         "الإعدادات، التنظيم: الأقسام كشجرة على الجنب (اطوي أو افتح، الرئيس، العدد)؛ اختار قسم تشوف وظايفه بنطاق الدرجات والمخطط قصاد الفعلي وأيام الإجازة؛ وكل الوظائف والدرجات تبويبات. إضافة أو تعديل بيفتح لوحة جانبية.",
         "الإعدادات، إعداد الحضور: الورديات والإجازات الرسمية في صفحة واحدة. أنواع الإجازات وأنواع المخالفات وأنواع المستندات (المستندات المطلوبة في كل ملف) وقوالب قوائم المهام (المهام عند انضمام أو مغادرة حد) في نفس القائمة."],
       "check": [
         "الصفحة الرئيسية مفيهاش أحمر آخر اليوم؛ كل ملف مكتمل 100% وله وظيفة ودرجة ومدير؛ والهيكل التنظيمي فيه شخص واحد فوق."],
       "problems": [
         "اترفض بسبب دايرة مديرين: حد هيبقى مدير نفسه من خلال السلسلة؛ حدد المدير في الملف بدل كده.",
         "حد مش ظاهر في المرتبات: افتح تبويب الراتب وحدد الحزمة.",
         "لينك قديم للأقسام أو الوظائف أو الدرجات أو الورديات أو الإجازات الرسمية بيفتح صفحة الإعداد الجديدة على التبويب الصح."]},
      {"title": "التعيين والمغادرة (الموارد البشرية)",
       "steps": [
         "تعيين جديد (من الصفحة الرئيسية للموارد البشرية أو قائمة الموظفين): املا البيانات الشخصية والوظيفة والراتب (بصلاحية المرتبات بس) والمستندات والدخول على النظام وبعدين المراجعة. كل التالي بيحفظ مسودة؛ احفظ وكمّل بعدين بيخليها تحت تعيينات لم تكتمل في الصفحة الرئيسية.",
         "خطوة المستندات: اسحب أكتر من ملف مرة واحدة أو صوّر بالموبايل، وبعدين اختار نوع كل واحد من قائمة اللي الوظيفة محتاجاه. أي ناقص ممكن ييجي بعدين.",
         "الدخول على النظام: ادّي حساب دخول (الدور الوظيفي بييجي من الوظيفة؛ اختار المخازن) أو من غير دخول للي مش بيستخدموا النظام. المناديب دايمًا ليهم حساب دخول.",
         "إنشاء: انسخ رابط الإعداد اللي بيظهر مرة واحدة على طول وابعته للشخص؛ بيفتحه ويختار كلمة السر. ضاع؟ ملفه بيقول بانتظار اختيار كلمة المرور وفيه رابط إعداد جديد.",
         "حد ماشي: من الملف، بدء إنهاء الخدمة. اختار آخر يوم شغل والسبب وتاريخ الإخطار، علّم على العهدة اللي اتسلمت، اقرا أرقام المخالصة للمرتبات، سلّم الناس والقسم والتجار والصفقات لحد (أو بعدين)، وبعدين أكّد.",
         "حسابه بيتقفل لوحده في نهاية آخر يوم. أي حاجة اتسابت لبعدين بتظهر تحت يحتاج مسؤولًا جديدًا في الصفحة الرئيسية؛ ادّي كل واحدة لمسؤول.",
         "المستندات: في الملف اضغط تذكير على مستند ناقص أو هيخلص (أو التذكير بكل النواقص)؛ الشخص بيوصله إشعار وتنبيه في ملفي، مرة واحدة في اليوم. المستندات، تقويم الانتهاء بيوريك اللي بيخلص كل يوم في الشهر."],
       "check": [
         "مفيش تعيين مستني تحت تعيينات لم تكتمل أكتر من يوم؛ يحتاج مسؤولًا جديدًا فاضية؛ وكل موظف جديد فتح رابط الإعداد في نفس الأسبوع."],
       "problems": [
         "خطوة الراتب مش ظاهرة: معندكش صلاحية المرتبات؛ مدير الموارد البشرية بيضيف الحزمة (تعيينات جديدة بانتظار الراتب في الصفحة الرئيسية).",
         "دور المالك بيدّيه بس اللي معاه إدارة الإعدادات؛ اطلب منه أو اختار دور تاني.",
         "الإيميل أو الموبايل مستخدم: ممكن الشخص له حساب أصلًا؛ دوّر في قائمة الموظفين الأول.",
         "معالج إنهاء الخدمة رافض لأنه آخر مالك: ادّي إدارة الإعدادات لحد تاني الأول."]},
      {"title": "المستخدمين والإعدادات",
       "steps": [
         "المستخدمين: اعمل أعضاء الفريق بوظيفة (بتملا صلاحياتهم في كل تطبيق والمخازن اللي مسؤولين عنها)، ومناديب (بفرع وكارنيه)، وأصحاب حسابات التجار؛ عدّل صلاحيات أي حد من تعديل (محدش يغير صلاحياته بنفسه) وضيف رقم سلاك.",
         "الإعدادات: دقائق الـSLA، السعة، الرسوم، مستويات إعادة التعبئة، ووقت الرد على التذاكر."],
       "check": [
         "سجل التدقيق بيوري كل تغيير ومين عمله."],
       "problems": [
         "حد ساب الشغل: وقف المستخدم في نفس اليوم؛ بيخرج من كل الأجهزة."]}
    ]}
}

# Phone notifications (web push): one section per role, the same steps with what each role is
# told about. Added to the end of every role's sections in both languages.
_PUSH_WHAT_EN = {
  "store_staff": "new orders to accept, late orders, shipments and transfers on their way to your store, tickets",
  "rider": "orders handed to you, tickets, a late clock in",
  "merchant": "orders delivered or failed, payouts paid, products running low (each only if your rights cover it)",
  "finance": "requests and payouts waiting for a second person, cash differences, riders holding cash too long, tickets",
  "admin": "urgent alerts (server errors, late orders, failed deliveries, goods not back), merchant sign ups, tickets",
}
_PUSH_WHAT_AR = {
  "store_staff": "الطلبات الجديدة اللي محتاجة قبول، الطلبات المتأخرة، الشحنات والتحويلات الجاية لفرعك، التذاكر",
  "rider": "الطلبات اللي اتسلمت لك، التذاكر، الحضور المتأخر",
  "merchant": "الطلبات اللي اتسلمت أو فشلت، الدفعات اللي اتحولت، المنتجات اللي قربت تخلص (كل واحدة لو صلاحياتك بتغطيها)",
  "finance": "الطلبات والدفعات اللي مستنية موافقة شخص تاني، فروق الفلوس، مناديب معاهم فلوس مدة طويلة، التذاكر",
  "admin": "التنبيهات العاجلة (أخطاء السيرفر، الطلبات المتأخرة، التوصيل الفاشل، البضاعة اللي مرجعتش)، تسجيل التجار، التذاكر",
}
for _role in EN:
  EN[_role]["sections"].append(
    {"title": "Turn on phone notifications",
     "steps": [
       "iPhone: open Shiply Now in Safari, tap Share, Add to Home Screen, then always open it from the Home Screen icon (needs iOS 16.4 or later). Android and computers: any browser works; installing the app is optional.",
       "Open the Settings menu (top of every screen), then Notifications.",
       "Tap Turn on notifications on this device and allow notifications when the phone asks.",
       "Tap Send me a test: a notification must appear within a few seconds.",
       f"Switch off the kinds you do not need. You are told about: {_PUSH_WHAT_EN[_role]}."],
     "check": [
       "The page says notifications are on for this device and the test arrived.",
       "Tapping a notification opens the right screen in Shiply Now."],
     "problems": [
       "Blocked: allow notifications for the site in the browser or phone settings, then turn it on again.",
       "No test arrives: check the phone is not in Do Not Disturb or battery saver, then send another test.",
       "A lost or old phone: remove it from Your devices on the same page."]})
  AR[_role]["sections"].append(
    {"title": "تشغيل إشعارات الموبايل",
     "steps": [
       "آيفون: افتح شيبلي ناو في سفاري، اضغط مشاركة، إضافة إلى الشاشة الرئيسية، وبعد كده افتحه دايما من الأيقونة (محتاج iOS 16.4 أو أحدث). أندرويد والكمبيوتر: أي متصفح شغال، وتثبيت التطبيق اختياري.",
       "افتح قائمة الإعدادات (فوق في كل شاشة) وبعدين الإشعارات.",
       "اضغط تفعيل الإشعارات على هذا الجهاز ووافق لما الموبايل يسأل.",
       "اضغط أرسل لي إشعارًا تجريبيًا: لازم يوصل إشعار في ثواني.",
       f"اقفل الأنواع اللي مش محتاجها. بيوصلك: {_PUSH_WHAT_AR[_role]}."],
     "check": [
       "الصفحة مكتوب فيها إن الإشعارات مفعّلة على الجهاز والتجربة وصلت.",
       "لما تدوس على الإشعار بيفتح الشاشة الصح في شيبلي ناو."],
     "problems": [
       "محظورة: اسمح بالإشعارات للموقع من إعدادات المتصفح أو الموبايل وفعّلها تاني.",
       "التجربة ما وصلتش: اتأكد إن الموبايل مش على عدم الإزعاج أو توفير البطارية وابعت تجربة تانية.",
       "موبايل ضاع أو قديم: شيله من أجهزتك في نفس الصفحة."]})

# Cash controls (CLAUDE.md, Cash controls): the rider cash limit and petty cash for store staff,
# the cash position and the month end checklist for finance. Each goes after its neighbour.
def _insert_after(role, title_en, title_ar, en, ar):
  for lang, title, section in ((EN, title_en, en), (AR, title_ar, ar)):
    sections = lang[role]["sections"]
    at = next((i for i, s in enumerate(sections) if s["title"] == title), len(sections) - 1)
    sections.insert(at + 1, section)

_insert_after(
  "store_staff", "Cash from riders", "فلوس المناديب",
  {"title": "Rider cash limit and petty cash",
   "steps": [
     "Home lists the riders holding cash, with the amount and since when. Red means held too long: take their cash in Rider cash now.",
     "If handing over a cash order says the rider is over the cash limit: take their cash first, then scan the badge again. Only a store manager may hand over anyway, with a written reason.",
     "Petty cash: open Petty cash, choose what it was for, type the amount and a note, take a photo of the receipt, and tap Pay from the box.",
     "Keep the paper receipt in the box envelope."],
   "check": [
     "The petty expense shows Paid (the box went down) or Waiting for approval (finance decides first).",
     "No rider on Home is red at the end of your shift."],
   "problems": [
     "The box does not hold that much: do not pay from your pocket; ask the store lead to call finance.",
     "No category fits: ask finance by ticket to open one; do not choose a wrong one.",
     "Rejected by finance: read the reason on the list and return the money or the item as told."]},
  {"title": "حد نقدية المندوب والنثريات",
   "steps": [
     "الرئيسية بتعرض المناديب اللي معاهم فلوس، بالمبلغ ومن إمتى. الأحمر يعني معاه من مدة طويلة: استلم فلوسه من فلوس المناديب حالا.",
     "لو التسليم قال إن المندوب فوق حد النقدية: استلم فلوسه الأول وبعدين اعمل سكان للبادج تاني. مدير الفرع بس يقدر يسلّم برضه بسبب مكتوب.",
     "النثريات: افتح النثريات، اختار المصروف لإيه، اكتب المبلغ وملاحظة، صوّر الإيصال، واضغط ادفع من الخزنة.",
     "احتفظ بالإيصال الورق في ظرف الخزنة."],
   "check": [
     "المصروف بيقول اتدفعت (الخزنة نقصت) أو مستنية موافقة (المالية تقرر الأول).",
     "مفيش مندوب أحمر في الرئيسية آخر الشيفت."],
   "problems": [
     "الخزنة مافيهاش المبلغ: ما تدفعش من جيبك؛ اطلب من مسؤول الفرع يكلم المالية.",
     "مفيش بند مناسب: اطلب من المالية بتذكرة يفتحوا بند؛ ما تختارش بند غلط.",
     "المالية رفضت: اقرا السبب في القائمة ورجّع الفلوس أو الحاجة زي ما اتقال."]})

_insert_after(
  "finance", "Month end", "آخر الشهر",
  {"title": "Cash position every morning",
   "steps": [
     "Open Accounting, Dashboard, Cash position.",
     "Banks and cash boxes: compare each with the bank app and the store box counts.",
     "Cash with riders: anything Overdue is chased today with the store manager (the store and finance also get a notification).",
     "Owed to merchants shows each merchant's next payout day; bills due within 7 days show what must leave soon. The net position is what is left after both.",
     "Export CSV when the owner asks for the day's position."],
   "check": [
     "No rider cash is Overdue by noon.",
     "Banks and boxes match the bank app and the counted boxes."],
   "problems": [
     "The net position is below zero: tell the owner the same day, with the bills and payouts due.",
     "A rider keeps holding cash past the limit: open a ticket to the store manager, and ask admin to lower the store's limit if it repeats."]},
  {"title": "موقف النقدية كل صبح",
   "steps": [
     "افتح الحسابات، لوحة التحكم، موقف النقدية.",
     "البنوك والخزن: قارن كل واحد بتطبيق البنك وعد خزن الفروع.",
     "النقدية مع المناديب: أي حاجة متأخرة تتابعها النهارده مع مدير الفرع (الفرع والمالية بيوصلهم إشعار كمان).",
     "المستحق للتجار بيوري ميعاد الدفعة الجاية لكل تاجر؛ والفواتير المستحقة خلال 7 أيام بتوري اللي لازم يخرج قريب. صافي الموقف هو اللي فاضل بعدهم.",
     "صدّر CSV لما المالك يطلب موقف اليوم."],
   "check": [
     "مفيش نقدية مندوب متأخرة لحد الضهر.",
     "البنوك والخزن مطابقين لتطبيق البنك والخزن المعدودة."],
   "problems": [
     "صافي الموقف تحت الصفر: بلّغ المالك نفس اليوم بالفواتير والدفعات المستحقة.",
     "مندوب بيفضل معاه فلوس فوق الحد: افتح تذكرة لمدير الفرع، واطلب من الأدمن يقلل حد الفرع لو اتكرر."]})

_insert_after(
  "finance", "Cash position every morning", "موقف النقدية كل صبح",
  {"title": "Petty cash and the month end checklist",
   "steps": [
     "Petty cash (Cash and bank): open the categories stores may use. Large petty expenses, or ones that would leave a box below its float, wait in Approvals; check the receipt photo before approving.",
     "Reverse a petty expense paid by mistake with a reason (approvers only); the money returns to the box.",
     "After the month ends open Configuration, Month end checklist and choose the month.",
     "Open each item that is not done and finish it: rider cash and differences, bank lines, receipts, petty cash, tax invoices, payroll, storage, depreciation.",
     "Prepare the VAT return in Tax returns, then tick VAT return with a note.",
     "When every item is done, tap Close the books."],
   "check": [
     "Every item shows Done (or a tick with a note) and the books are closed through the last day."],
   "problems": [
     "An item cannot be finished (for example a day without stock shows storage missing): tick it by hand with a note that explains why.",
     "Something was ticked by mistake: Untick it; every tick and untick is in the history."]},
  {"title": "النثريات وقائمة إقفال الشهر",
   "steps": [
     "النثريات (الكاش والبنك): افتح البنود اللي الفروع تقدر تستخدمها. النثريات الكبيرة، أو اللي هتنزّل الخزنة تحت رصيدها الثابت، بتستنى في الموافقات؛ راجع صورة الإيصال قبل الموافقة.",
     "ألغي مصروف نثريات اتدفع غلط بسبب (اللي بيوافقوا بس)؛ الفلوس بترجع الخزنة.",
     "بعد ما الشهر يخلص افتح الإعدادات، قائمة إقفال الشهر واختار الشهر.",
     "افتح كل بند لسه ماخلصش وخلّصه: نقدية المناديب والفروق، سطور البنك، الإيصالات، النثريات، الفواتير الضريبية، المرتبات، التخزين، الإهلاك.",
     "جهّز إقرار القيمة المضافة من الإقرارات الضريبية، وبعدين علّم على إقرار القيمة المضافة بملاحظة.",
     "لما كل البنود تخلص، اضغط اقفل الدفاتر."],
   "check": [
     "كل بند مكتوب عليه خلص (أو علامة بملاحظة) والدفاتر مقفولة لحد آخر يوم."],
   "problems": [
     "بند مش هينفع يخلص (مثلا يوم من غير مخزون باين إن تخزينه ناقص): علّم عليه باليد بملاحظة بتشرح السبب.",
     "علّمت على حاجة غلط: شيل العلامة؛ كل علامة وشيلها متسجلة في السجل."]})

# The Sales app (docs/SALES.md): reps and sales managers. Added last, with its own notifications
# section (the loop above covers the roles before it).
EN["sales"] = {
  "title": "Sales reps and sales managers",
  "who": "Sales reps follow their own leads from the first call to the signed proposal; sales managers give out leads, approve discounts and commission and set targets. Open the Sales app from Home.",
  "day": [
    "Start of day (first 15 minutes): open My day. Do the overdue follow ups first, then today's, then give every open deal without a next step a planned follow up.",
    "During the day: after every call, meeting or message, log what happened on the deal and plan the next step before you close it.",
    "Proposals: check Proposals for brands that viewed or accepted; confirm an accepted proposal the same day.",
    "Managers, morning: give out the leads in Leads, Waiting to be assigned; answer discounts in Proposals, To approve; look at the Dashboard (overdue follow ups, stuck deals).",
    "Managers, first working days of the month: set next month's targets in Targets and approve last month's commission in Commission."
  ],
  "escalation": [
    "A brand asks for a discount above the limit: make the proposal and tap Ask a manager to approve; do not promise the price before it is approved.",
    "The brand accepted but the owner's email is already used: ask the brand for another email, or open a ticket to admin if the person already works with us.",
    "A won merchant's owner lost their setup link: open the deal and tap New setup link.",
    "Your commission looks wrong: open a ticket to your sales manager with the month and the merchant before it is approved.",
    "A website lead or sign up looks like spam: tell your sales manager, who marks it lost with the reason Other and a note."
  ],
  "sections": [
    {"title": "Work a lead to a proposal",
     "steps": [
       "Open the deal from My day, Leads or the Pipeline.",
       "Call the contact (tap the phone) or message them on WhatsApp. Log what happened with Log what happened.",
       "Plan the next step with a date and time; every open deal needs one.",
       "Move the deal along its stages as it happens: Contacted, Meeting.",
       "Correct the expected orders a month and the monthly fee value as you learn them."],
     "check": [
       "The deal shows a next step with a date, and the board card has no No next step flag."],
     "problems": [
       "The brand is not interested: Mark lost with the right reason (Other needs a note).",
       "The lead belongs to another rep's company: ask your sales manager to move it."]},
    {"title": "Make and send a proposal",
     "steps": [
       "On the deal, in Proposals, tap New proposal. The rates start from our current fees.",
       "Change the rates you agreed. For one price per shipment tap All inclusive shipping fee, then type the shipping fee. Add prices per product if agreed: pick the brand's products, or add a row with the SKU and name when they have no products with us yet. A failed delivery share (for example 100%) replaces the fixed failed fee.",
       "Add volume tiers on any fee if any, the payout schedule and minimum payout, the delivery promise and attempts, the orders a month and average order value for the example month, the minimum, deposit, credit limit and the contract's start, length and notice.",
       "If the form says the discount is past the limit, save it and tap Ask a manager to approve. Wait for the approval notification.",
       "Tap Send. The deal moves to Proposal. Tap Copy link and send it to the brand by WhatsApp or email.",
       "To change a sent proposal, make a New version: the old link stops working."],
     "check": [
       "The proposal shows Sent with the day it stays open until, then Viewed once the brand opens it."],
     "problems": [
       "The brand says the link does not open: check it is the latest version; an expired one needs a new version.",
       "You typed a wrong rate in a sent proposal: make a new version at once and send the new link."]},
    {"title": "Confirm an accepted proposal",
     "steps": [
       "When the brand accepts you get a notification. Open the deal.",
       "Tap Confirm and open the merchant. Check the owner's name, email (their login) and mobile.",
       "Tap Confirm. The deal is won; the merchant, its contract version (every price, tier and term of the proposal, in force from the contract start) and the owner's login are made in one step.",
       "Copy the setup link that appears and send it to the owner: it works once and is shown only now.",
       "If the proposal lists Product prices without a product, ask the merchant's account manager to add those prices in the contract once the products exist."],
     "check": [
       "The deal shows Won and the merchant's name; the merchant's page shows its contract.",
       "The owner can sign in after choosing a password."],
     "problems": [
       "Email already used: ask for another email and confirm again; nothing was made.",
       "The owner lost the link or it ran out: tap New setup link on the deal."]},
    {"title": "Targets and commission",
     "steps": [
       "The rule: you have a fees target each month. A merchant you won counts for you once it has had delivered orders in two different months (from that second month on, never backwards), for its first 12 months from the win.",
       "When the month is over: if your counted fees reach the target or more, you earn 5% of all your counted fees; below the target, or with no target, the month pays nothing. Example: target 500,000 EGP, counted 520,000 EGP: hit, 5% = 26,000 EGP. Counted 480,000 EGP: missed, 0.",
       "Dashboard and Commission show your counted fees so far against the target, how much more you need, the commission at this level if you hit it, and the merchants still pending (0 or 1 of 2 active months).",
       "Managers: in Targets, type each rep's deals, orders and fees target for the month and Save. The page lists reps without a fees target this month and next.",
       "Managers: in Commission, check each draft (counted fees, target, merchants, share), then Approve, or Change with a reason. Another manager approves your own. Missed months and months without a target close at 0 by themselves and need no approval.",
       "Approved commission is paid with the salary of that month's run, or as a bonus by Accounting for people hired through an outsourcing company."],
     "check": [
       "Every rep has a fees target before the month starts; every commission of last month is Approved by the 5th."],
     "problems": [
       "A merchant is missing from a rep's commission: check the deal is won with its merchant, the rep was its owner when it was won, and the merchant has delivered orders in two different months.",
       "A rep had no target in a month that is over: that month closed at 0; set targets before each month starts so it does not happen.",
       "Paid commission was wrong: it cannot be changed; tell Accounting, who correct it in a later month."]},
    {"title": "Turn on phone notifications",
     "steps": [
       "iPhone: open Shiply Now in Safari, tap Share, Add to Home Screen, then always open it from the Home Screen icon (needs iOS 16.4 or later). Android and computers: any browser works.",
       "Open the Settings menu (top of every screen), then Notifications, and turn them on for this device.",
       "You are told about: leads given to you, follow ups due or late, stuck deals, discounts waiting for approval (managers) and brands accepting or declining proposals."],
     "check": [
       "Send me a test arrives within a few seconds."],
     "problems": [
       "Blocked: allow notifications for the site in the browser or phone settings, then turn it on again."]}
  ]
}
AR["sales"] = {
  "title": "مندوبين ومديرين المبيعات",
  "who": "مندوب المبيعات بيتابع عملاءه من أول مكالمة لحد العرض الموقّع؛ مدير المبيعات بيوزع العملاء ويوافق على الخصومات والعمولة ويحدد الأهداف. افتح تطبيق المبيعات من الرئيسية.",
  "day": [
    "أول اليوم (أول 15 دقيقة): افتح يومي. خلّص المتابعات المتأخرة الأول، وبعدين بتاعة النهارده، وبعدين كل صفقة مفتوحة من غير خطوة جاية حطلها متابعة.",
    "طول اليوم: بعد كل مكالمة أو اجتماع أو رسالة، سجّل اللي حصل على الصفقة وحدد الخطوة الجاية قبل ما تقفلها.",
    "العروض: راجع العروض اللي العلامة التجارية شافتها أو قبلتها؛ أكّد العرض المقبول في نفس اليوم.",
    "المديرين الصبح: وزّع العملاء من العملاء المحتملين، في انتظار التوزيع؛ رد على الخصومات من العروض، للموافقة؛ بص على لوحة المتابعة (المتابعات المتأخرة والصفقات المتوقفة).",
    "المديرين أول أيام الشهر: حدد أهداف الشهر الجاي من الأهداف واعتمد عمولة الشهر اللي فات من العمولة."
  ],
  "escalation": [
    "علامة تجارية طالبة خصم فوق الحد: اعمل العرض واضغط اطلب موافقة المدير؛ ما توعدش بالسعر قبل الموافقة.",
    "العلامة قبلت بس بريد المالك مستخدم: اطلب من العلامة بريد تاني، أو افتح تذكرة للأدمن لو الشخص شغال معانا أصلا.",
    "مالك تاجر مكسوب ضيّع رابط الإعداد: افتح الصفقة واضغط رابط إعداد جديد.",
    "عمولتك شكلها غلط: افتح تذكرة لمدير المبيعات بالشهر والتاجر قبل ما تتعتمد.",
    "عميل من الموقع أو تسجيل شكله سبام: بلّغ مدير المبيعات، وهو يعلّمه خسارة بسبب أخرى وملاحظة."
  ],
  "sections": [
    {"title": "شغّل العميل لحد العرض",
     "steps": [
       "افتح الصفقة من يومي أو العملاء المحتملين أو مسار الصفقات.",
       "كلّم جهة الاتصال (اضغط على الرقم) أو ابعتله واتساب. سجّل اللي حصل من سجّل ما حدث.",
       "حدد الخطوة الجاية بتاريخ ووقت؛ كل صفقة مفتوحة لازم يبقى لها خطوة.",
       "حرّك الصفقة في مراحلها لما تحصل: تم التواصل، اجتماع.",
       "صحّح الطلبات المتوقعة في الشهر وقيمة الرسوم الشهرية لما تعرفهم."],
     "check": [
       "الصفقة عليها خطوة جاية بتاريخ، وكارت اللوحة مافيهوش علامة بدون خطوة تالية."],
     "problems": [
       "العلامة مش مهتمة: علّمها خسارة بالسبب الصح (أخرى محتاجة ملاحظة).",
       "العميل تبع شركة مندوب تاني: اطلب من مدير المبيعات ينقله."]},
    {"title": "اعمل عرض وابعته",
     "steps": [
       "على الصفقة، في العروض، اضغط عرض جديد. الأسعار بتبدأ من رسومنا الحالية.",
       "غيّر الأسعار اللي اتفقتوا عليها. لو سعر واحد لكل شحنة اضغط رسوم شحن شاملة وبعدين اكتب رسوم الشحن. ضيف سعر لكل منتج لو اتفقتوا: اختار من منتجات العلامة، أو ضيف صف بالرمز والاسم لو ملهمش منتجات عندنا لسه. نسبة التوصيل الفاشل (مثلا 100%) بتحل محل الرسم الثابت.",
       "ضيف شرائح الكمية على أي رسم لو فيه، ومواعيد التحويل والحد الأدنى للتحويل، ومدة التوصيل والمحاولات، والطلبات في الشهر ومتوسط قيمة الطلب للشهر المثال، والحد الأدنى والتأمين وحد الائتمان وبداية العقد ومدته والإخطار.",
       "لو الشاشة قالت إن الخصم فوق الحد، احفظ واضغط اطلب موافقة المدير. استنى إشعار الموافقة.",
       "اضغط إرسال. الصفقة بتروح مرحلة العرض. اضغط نسخ الرابط وابعته للعلامة على واتساب أو الإيميل.",
       "عشان تغيّر عرض اتبعت، اعمل نسخة جديدة: الرابط القديم بيبطل."],
     "check": [
       "العرض مكتوب عليه مُرسل وآخر يوم مفتوح فيه، وبعدين تمت المشاهدة أول ما العلامة تفتحه."],
     "problems": [
       "العلامة بتقول الرابط مش بيفتح: اتأكد إنه آخر نسخة؛ العرض المنتهي محتاج نسخة جديدة.",
       "كتبت سعر غلط في عرض اتبعت: اعمل نسخة جديدة فورا وابعت الرابط الجديد."]},
    {"title": "أكّد عرض مقبول",
     "steps": [
       "لما العلامة تقبل بيوصلك إشعار. افتح الصفقة.",
       "اضغط تأكيد وفتح حساب التاجر. راجع اسم المالك وبريده (للدخول) وموبايله.",
       "اضغط تأكيد. الصفقة بتتكسب، والتاجر وإصدار عقده (كل أسعار وشرائح وشروط العرض، ساري من بداية العقد) وحساب المالك بيتعملوا في خطوة واحدة.",
       "انسخ رابط الإعداد اللي بيظهر وابعته للمالك: بيشتغل مرة واحدة وبيظهر دلوقتي بس.",
       "لو العرض فيه أسعار منتجات من غير منتج، اطلب من مدير حساب التاجر يضيف الأسعار دي في العقد أول ما المنتجات تتعمل."],
     "check": [
       "الصفقة مكتوب عليها تم الفوز واسم التاجر؛ وصفحة التاجر فيها العقد.",
       "المالك يقدر يدخل بعد ما يختار كلمة المرور."],
     "problems": [
       "البريد مستخدم: اطلب بريد تاني وأكّد تاني؛ ماحصلش أي حاجة.",
       "المالك ضيّع الرابط أو خلص: اضغط رابط إعداد جديد على الصفقة."]},
    {"title": "الأهداف والعمولة",
     "steps": [
       "القاعدة: ليك هدف رسوم كل شهر. رسوم التاجر اللي كسبته بتتحسب ليك بعد ما يبقى له طلبات متسلمة في شهرين مختلفين (من الشهر التاني ده وبعده، مش بأثر رجعي)، ولمدة أول 12 شهر من الفوز.",
       "بعد ما الشهر يخلص: لو الرسوم المحسوبة وصلت الهدف أو عدته، تاخد 5٪ من كل الرسوم المحسوبة؛ لو أقل من الهدف أو مفيش هدف، مفيش عمولة الشهر ده. مثال: الهدف 500,000 جنيه والمحسوب 520,000 جنيه: وصلت، 5٪ = 26,000 جنيه. المحسوب 480,000 جنيه: موصلتش، صفر.",
       "لوحة المتابعة والعمولة بيوروك الرسوم المحسوبة لحد دلوقتي مقابل الهدف، فاضل قد إيه، العمولة بالمستوى ده لو وصلت، والتجار اللي لسه مستنيين (0 أو 1 من 2 شهر نشط).",
       "المديرين: في الأهداف، اكتب لكل مندوب الصفقات والطلبات وهدف الرسوم للشهر واضغط حفظ. الصفحة بتوريك مين مالوش هدف الشهر ده والشهر الجاي.",
       "المديرين: في العمولة، راجع كل مسودة (الرسوم المحسوبة والهدف والتجار والنسبة)، وبعدين اعتماد، أو تعديل بسبب. مدير تاني بيعتمد عمولتك. الشهور اللي متوصلتش أو مالهاش هدف بتتقفل بصفر لوحدها ومش محتاجة اعتماد.",
       "العمولة المعتمدة بتتصرف مع مرتب الشهر، أو كمكافأة من الحسابات لو الشخص شغال عن طريق شركة توظيف."],
     "check": [
       "كل مندوب له هدف رسوم قبل ما الشهر يبدأ؛ وكل عمولة الشهر اللي فات معتمدة قبل يوم 5."],
     "problems": [
       "تاجر ناقص من عمولة مندوب: اتأكد إن الصفقة مكسوبة بالتاجر وإن المندوب كان صاحبها وقت الفوز، وإن التاجر له طلبات متسلمة في شهرين مختلفين.",
       "مندوب مالوش هدف في شهر خلص: الشهر ده اتقفل بصفر؛ حدد الأهداف قبل أول الشهر عشان ده ميحصلش.",
       "عمولة اتصرفت غلط: مش بتتغير؛ بلّغ الحسابات وهما يصححوها في شهر بعده."]},
    {"title": "تشغيل إشعارات الموبايل",
     "steps": [
       "آيفون: افتح شيبلي ناو في سفاري، اضغط مشاركة، إضافة إلى الشاشة الرئيسية، وبعد كده افتحه دايما من الأيقونة (محتاج iOS 16.4 أو أحدث). أندرويد والكمبيوتر: أي متصفح شغال.",
       "افتح قائمة الإعدادات (فوق في كل شاشة) وبعدين الإشعارات، وفعّلها على الجهاز ده.",
       "بيوصلك: العملاء اللي اتوزعوا عليك، المتابعات اللي جه ميعادها أو اتأخرت، الصفقات المتوقفة، الخصومات اللي مستنية موافقة (المديرين) والعلامات اللي قبلت أو رفضت العروض."],
     "check": [
       "أرسل لي إشعارًا تجريبيًا بيوصل في ثواني."],
     "problems": [
       "محظورة: اسمح بالإشعارات للموقع من إعدادات المتصفح أو الموبايل وفعّلها تاني."]}
  ]
}

# HR phase 3 (docs/HR.md "Phase 3 as built"): leave, violations, attendance fixes and the inbox.
# Every employee (store staff and riders) asks from My HR; managers approve first; HR (admin)
# approves second, records violations and decides appeals; finance sees HR's deductions in the
# salary run.
_SELF_EN = {
  "title": "Leave, violations and attendance fixes",
  "steps": [
    "Open the Settings menu, then My HR. Leave shows how many annual days you have left and your other leave.",
    "To ask for leave: choose the type, the dates (or a half day), write a note and send. Attach a medical note when the type asks for one. Ask early: some types need days of notice.",
    "Your manager approves first, then HR. You get a notification at each step; a request still waiting can be cancelled from the list.",
    "Violations shows anything recorded for you and its penalty. If you disagree, tap Appeal and write why, within the days shown; you can appeal once.",
    "A day that is wrong (forgot to clock in, phone dead): Attendance fixes, choose the day, the right times and what happened. Your manager approves, then HR fixes the day.",
    "If you manage people: Inbox lists your team's leave and fixes; approve or refuse with a reason. The team's leave calendar is below."],
  "check": [
    "The request shows Approved and the days appear on your roster as leave.",
    "An appeal shows Appealed until HR decides; the decision comes as a notification."],
  "problems": [
    "More than the balance: ask fewer days, or ask HR (they may give unpaid days).",
    "The dates overlap another request: cancel the old one first.",
    "Your manager is away: ask HR; they can refuse or wait, and HR asks for leave on your behalf when needed."]}
_SELF_AR = {
  "title": "الإجازات والمخالفات وتصحيح الحضور",
  "steps": [
    "افتح قائمة الإعدادات وبعدين ملفي. الإجازات بتوريك فاضل لك كام يوم اعتيادي وباقي إجازاتك.",
    "عشان تطلب إجازة: اختار النوع والتواريخ (أو نص يوم)، اكتب ملاحظة وابعت. ارفع الشهادة الطبية لو النوع طالبها. اطلب بدري: فيه أنواع محتاجة إخطار قبلها بأيام.",
    "مديرك بيوافق الأول وبعدين شؤون العاملين. بيوصلك إشعار في كل خطوة؛ والطلب اللي لسه مستني تقدر تلغيه من القائمة.",
    "المخالفات بتوريك أي حاجة اتسجلت عليك وجزاءها. لو مش موافق اضغط تظلم واكتب السبب في خلال الأيام المكتوبة؛ التظلم مرة واحدة بس.",
    "يوم متسجل غلط (نسيت تسجل حضور، الموبايل فصل): تصحيح الحضور، اختار اليوم والأوقات الصح واكتب اللي حصل. مديرك يوافق وبعدين شؤون العاملين تصلح اليوم.",
    "لو بتدير ناس: الوارد فيه إجازات وتصحيحات فريقك؛ وافق أو ارفض بسبب. وتقويم إجازات الفريق تحته."],
  "check": [
    "الطلب بيقول موافق عليه والأيام بتظهر في جدولك كإجازة.",
    "التظلم بيقول متظلم منها لحد ما شؤون العاملين تقرر؛ والقرار بيوصلك إشعار."],
  "problems": [
    "أكتر من الرصيد: اطلب أيام أقل، أو كلم شؤون العاملين (ممكن يدّوك أيام بدون أجر).",
    "التواريخ متداخلة مع طلب تاني: الغي القديم الأول.",
    "مديرك مش موجود: كلم شؤون العاملين؛ وهما يقدروا يطلبوا الإجازة نيابة عنك لو لازم."]}
for _role in ("store_staff", "rider"):
  _insert_after(_role, "Clock in and out", "تسجيل الحضور والانصراف", dict(_SELF_EN), dict(_SELF_AR))

_insert_after(
  "admin", "Attendance and shifts", "الحضور والورديات",
  {"title": "Leave and violations (HR)",
   "steps": [
     "HR, Configuration: set annual leave days on each grade (a position may override it); HR settings hold the default 21 days, casual days, the leave year, monthly or yearly accrual, carry over, how far back a request may start, the days per month of pay, the violation period and the appeal days.",
     "HR, Configuration, Leave types: what each type allows (paid, which balance, document above N days, most days, notice, self request). Configuration, Violation types: each ladder of penalties.",
     "HR, Inbox every morning: approve or refuse leave at the HR step (the manager already approved), apply or refuse attendance fixes, decide appeals of violations you did not record.",
     "HR, Time, Leave requests: Ask for leave for someone when they cannot (you may allow more than the balance, the extra days unpaid, or a start further back). Cancel approved leave with a reason before payroll takes it.",
     "HR, Time, Leave balances: adjust a balance with a reason (old leave, a correction); Calendar shows who is off by department and store.",
     "HR, Discipline, Violations: Record a violation; the ladder picks the step from earlier ones in the period (change it only with a reason). Add a photo or PDF as evidence. Suggested lists lateness and absences from attendance: Confirm or Dismiss each.",
     "For outsourcing companies lists final deductions of outsourced people: send them to their company each month."],
   "check": [
     "The Inbox count is zero by noon; suggested violations are handled within two days.",
     "Before payroll: every leave request of the month is decided, so unpaid days reach the run."],
   "problems": [
     "A request is stuck at the manager: the manager in force is shown on the request; remind them or fix the manager on the file.",
     "A suggestion is wrong (the person was on leave): correct the attendance day or approve the leave; the suggestion falls away.",
     "Termination review alert: never automatic; review the file with the owner and decide."]},
  {"title": "الإجازات والمخالفات (شؤون العاملين)",
   "steps": [
     "شؤون العاملين، الإعدادات: حدد أيام الإجازة الاعتيادية لكل درجة (والوظيفة ممكن تغيرها)؛ وإعدادات شؤون العاملين فيها الافتراضي 21 يوم، أيام العارضة، سنة الإجازات، الاستحقاق شهري أو سنوي، الترحيل، أقصى رجوع للخلف للطلب، أيام الشهر لحساب أجر اليوم، مدة المخالفات وأيام التظلم.",
     "شؤون العاملين، الإجازات، أنواع الإجازات: كل نوع بيسمح بإيه (بأجر، أنهي رصيد، مستند لأكتر من كام يوم، أقصى أيام، الإخطار، الموظف يطلبها). المخالفات، أنواع المخالفات: سلم الجزاءات لكل نوع.",
     "شؤون العاملين، الوارد كل صبح: وافق أو ارفض الإجازات في مرحلة شؤون العاملين (المدير وافق خلاص)، نفّذ أو ارفض تصحيحات الحضور، وابت في التظلمات من المخالفات اللي ما سجلتهاش.",
     "شؤون العاملين، الإجازات، الطلبات: اطلب إجازة لموظف لو مش قادر (تقدر تسمح بأكتر من الرصيد والأيام الزيادة بدون أجر، أو بداية أقدم). الغي إجازة موافق عليها بسبب قبل ما المرتبات تاخدها.",
     "شؤون العاملين، الإجازات، الأرصدة: عدّل رصيد بسبب (إجازة قديمة، تصحيح)؛ والتقويم بيوري مين في إجازة حسب القسم والمخزن.",
     "شؤون العاملين، المخالفات: سجّل مخالفة؛ السلم بيختار الدرجة من المخالفات السابقة في المدة (غيرها بسبب بس). ارفع صورة أو PDF كإثبات. المقترحة فيها التأخير والغياب من الحضور: أكّد أو تجاهل كل واحدة.",
     "لشركات توريد العمالة فيها الخصومات النهائية للعمالة الخارجية: ابعتها لشركتهم كل شهر."],
   "check": [
     "عداد الوارد صفر قبل الضهر؛ والمخالفات المقترحة بتتراجع في خلال يومين.",
     "قبل المرتبات: كل طلبات إجازة الشهر اتقررت، عشان الأيام بدون أجر تدخل المسير."],
   "problems": [
     "طلب واقف عند المدير: المدير الحالي مكتوب على الطلب؛ فكّره أو صحح المدير في الملف.",
     "اقتراح غلط (الموظف كان في إجازة): صحح يوم الحضور أو وافق على الإجازة؛ والاقتراح هيختفي.",
     "تنبيه مراجعة إنهاء الخدمة: عمره ما بيحصل لوحده؛ راجع الملف مع المالك وقرر."]})

_insert_after(
  "finance", "Salaries and advances", "المرتبات والسلف",
  {"title": "HR deductions in the salary run",
   "steps": [
     "The run brings HR's items by itself: unpaid leave days and final violation deductions not taken yet, each listed per person under HR deductions.",
     "A day of pay is the basic salary divided by the HR setting (30 by default); the deductions lower the gross before tax.",
     "Each item is taken once: the run marks it, so the next month never takes it again."],
   "check": [
     "The payslip shows the HR deduction lines next to the gross."],
   "problems": [
     "A deduction looks wrong: do not change it in the run; ask HR, who cancel or correct the violation or the leave before you run."]},
  {"title": "خصومات شؤون العاملين في المسير",
   "steps": [
     "المسير بيجيب بنود شؤون العاملين لوحده: أيام الإجازة بدون أجر وخصومات المخالفات النهائية اللي لسه ما اتاخدتش، كل واحدة مكتوبة للموظف تحت خصومات شؤون العاملين.",
     "أجر اليوم هو المرتب الأساسي مقسوم على إعداد شؤون العاملين (30 افتراضيًا)؛ والخصومات بتقلل الإجمالي قبل الضريبة.",
     "كل بند بيتاخد مرة واحدة: المسير بيعلّمه، فالشهر الجاي عمره ما ياخده تاني."],
   "check": [
     "قسيمة المرتب فيها بنود خصم شؤون العاملين جنب الإجمالي."],
   "problems": [
     "خصم شكله غلط: ما تغيروش في المسير؛ كلم شؤون العاملين يلغوا أو يصححوا المخالفة أو الإجازة قبل ما تشغل المسير."]})

# Rider pay (CLAUDE.md "Rider pay"): riders earn per delivered order only, through their wallet
# and withdrawals; Accounting approves and pays; store managers hand over cash withdrawals; HR
# keeps the pay basis on the file.
_insert_after(
  "rider", "Cash at the end of the shift", "الفلوس آخر الشيفت",
  {"title": "My wallet and withdrawals",
   "steps": [
     "You earn a fixed amount for every delivered order (shown in My wallet). A failed attempt earns nothing. There is no salary, tax or insurance.",
     "Open My wallet from your home screen: Available to withdraw, On hold (each earning frees up a few working days after its delivery day; Fridays and official holidays do not count), and what you owe.",
     "What you owe (cash short at hand in, damage charged to you, penalties, an advance) is taken first: the form shows what leaves your wallet, what is taken and what you receive.",
     "Tap Withdraw money, type the amount or tap All available, choose how: cash at your store, InstaPay, a mobile wallet (Vodafone Cash, Etisalat Cash, Orange Cash, WE Pay) or a bank IBAN, then Send request.",
     "You can cancel a request until Accounting approves it. You get a notification when it is approved, paid or not approved."],
   "check": [
     "The request shows Waiting, then Approved, then Paid with the reference.",
     "Cash at the store: the store manager hands you the cash and records it; count it in front of them."],
   "problems": [
     "Not approved: read the reason under the request; the amount is back in your wallet at once.",
     "An earning is missing: check the order was delivered (not failed); ask your store lead with the order number.",
     "You do not agree with what you owe: ask your store lead or write a ticket to finance before you withdraw."]},
  {"title": "محفظتي والسحب",
   "steps": [
     "بتكسب مبلغ ثابت عن كل طلب اتسلّم (مكتوب في محفظتي). المحاولة الفاشلة مالهاش أجر. مفيش مرتب ولا ضرايب ولا تأمينات.",
     "افتح محفظتي من الشاشة الرئيسية: متاح للسحب، معلّق (كل مبلغ بيبقى متاح بعد كام يوم عمل من يوم التوصيل؛ الجمعة والإجازات الرسمية مش محسوبة)، واللي عليك.",
     "اللي عليك (عجز في تسليم الكاش، تلفيات اتحسبت عليك، جزاءات، سلفة) بيتخصم الأول: الفورم بيوريك اللي هيطلع من محفظتك واللي هيتخصم واللي هتقبضه.",
     "اضغط اسحب فلوسي، اكتب المبلغ أو اضغط كل المتاح، واختار الطريقة: كاش من المخزن، إنستاباي، محفظة موبايل (فودافون كاش، اتصالات كاش، أورنج كاش، WE Pay) أو آيبان بنكي، وبعدين ابعت الطلب.",
     "تقدر تلغي الطلب لحد ما الحسابات توافق عليه. هيوصلك إشعار لما يتوافق عليه أو يتصرف أو يترفض."],
   "check": [
     "الطلب بيبقى مستني، وبعدين اتوافق عليه، وبعدين اتصرف بالمرجع.",
     "الكاش من المخزن: مدير المخزن بيسلّمك الكاش ويسجّله؛ عدّه قدامه."],
   "problems": [
     "اترفض: اقرا السبب تحت الطلب؛ المبلغ بيرجع محفظتك على طول.",
     "مبلغ ناقص: اتأكد إن الطلب اتسلّم (مش فاشل)؛ اسأل مسؤول المخزن برقم الطلب.",
     "مش موافق على اللي عليك: كلم مسؤول المخزن أو اكتب تذكرة للمالية قبل ما تسحب."]})

_insert_after(
  "store_staff", "Rider cash limit and petty cash", "حد نقدية المندوب والنثريات",
  {"title": "Rider withdrawals in cash (store manager)",
   "steps": [
     "Riders may ask to be paid in cash at the store. Once Accounting approves, the request shows under Rider withdrawals in cash on the Cash screen (store managers only).",
     "Count the amount from the store box in front of the rider, hand it over, then tap Cash given (add a note if needed).",
     "The amount comes out of the store cash box; nothing else to record."],
   "check": [
     "The request shows Paid; the rider's app shows it paid."],
   "problems": [
     "The box does not hold enough: do not pay part of it; tell finance by ticket (they may pay by transfer instead).",
     "The rider asks for cash that is not on the list: it is not approved yet; send them to Accounting."]},
  {"title": "سحوبات المناديب كاش (مدير المخزن)",
   "steps": [
     "المندوب ممكن يطلب يقبض كاش من المخزن. بعد موافقة الحسابات، الطلب بيظهر تحت سحوبات المناديب كاش في شاشة الكاش (لمدير المخزن بس).",
     "عدّ المبلغ من خزنة المخزن قدام المندوب، سلّمه، وبعدين اضغط الكاش اتسلّم (اكتب ملاحظة لو محتاج).",
     "المبلغ بيطلع من خزنة المخزن؛ مفيش حاجة تانية تتسجل."],
   "check": [
     "الطلب بيقول اتصرف؛ وتطبيق المندوب بيوريه مصروف."],
   "problems": [
     "الخزنة مفيهاش كفاية: ما تدفعش جزء؛ بلّغ المالية بتذكرة (ممكن يحوّلوا بدل الكاش).",
     "المندوب بيطلب كاش مش في القائمة: لسه ما اتوافقش عليه؛ وجّهه للحسابات."]})

_insert_after(
  "finance", "Salaries and advances", "المرتبات والسلف",
  {"title": "Rider withdrawals",
   "steps": [
     "Riders are paid per delivered order only, never on the salary run. Accounting, Employees, Riders shows each rider's wallet: cash carried, in the wallet, on hold, owed and available.",
     "Accounting, Employees, Rider withdrawals: Open lists new requests and approved ones to pay. Each shows the rider, store, what they receive, what is deducted for what they owe and where the money goes.",
     "Check the details (IBAN, wallet number), then Approve, or Reject with a reason the rider reads.",
     "Pay: send the transfer (bank, InstaPay or wallet), then choose the bank or box it came from (cash at the store defaults to the store box, others to CIB), type the reference and Mark paid. One entry pays the rider and clears what they owed.",
     "From the approval limit another person pays what you approved. Cash at the store can also be handed over by the store manager."],
   "check": [
     "Nothing stays Approved for more than a working day; Paid requests carry the transfer reference."],
   "problems": [
     "Pay refused because the wallet changed (a new charge after the request): reject with a reason; the rider asks again.",
     "The bank or box does not hold enough: pay from another account or deposit first.",
     "Wrong details: reject with the reason; never change the rider's details yourself."]},
  {"title": "سحوبات المناديب",
   "steps": [
     "المناديب بيقبضوا بالطلب المُسلَّم بس، وعمرهم ما بيكونوا على مسير المرتبات. الحسابات، الموظفين، المناديب بتوري محفظة كل مندوب: الكاش اللي معاه، اللي في المحفظة، المعلّق، اللي عليه، والمتاح.",
     "الحسابات، الموظفين، سحوبات المناديب: المفتوحة فيها الطلبات الجديدة والموافق عليها للصرف. كل طلب بيوري المندوب والمخزن واللي هيقبضه والمخصوم من اللي عليه والفلوس رايحة فين.",
     "راجع البيانات (الآيبان، رقم المحفظة)، وبعدين وافق، أو ارفض بسبب المندوب هيقراه.",
     "الصرف: ابعت التحويل (بنك أو إنستاباي أو محفظة)، واختار البنك أو الخزنة اللي طلع منها (الكاش من المخزن افتراضيًا من خزنة المخزن، والباقي من CIB)، اكتب المرجع واضغط سجّل الصرف. قيد واحد بيصرف للمندوب ويقفل اللي عليه.",
     "من حد الموافقة شخص تاني هو اللي يصرف اللي إنت وافقت عليه. الكاش من المخزن ممكن مدير المخزن يسلّمه كمان."],
   "check": [
     "مفيش طلب بيفضل موافق عليه أكتر من يوم عمل؛ والمصروف عليه مرجع التحويل."],
   "problems": [
     "الصرف اترفض لأن المحفظة اتغيرت (خصم جديد بعد الطلب): ارفض بسبب؛ والمندوب يطلب تاني.",
     "البنك أو الخزنة مفيهمش كفاية: اصرف من حساب تاني أو اعمل إيداع الأول.",
     "بيانات غلط: ارفض بالسبب؛ عمرك ما تغير بيانات المندوب بنفسك."]})

_insert_after(
  "admin", "Leave and violations (HR)", "الإجازات والمخالفات (شؤون العاملين)",
  {"title": "Rider pay basis (HR)",
   "steps": [
     "Riders are paid per delivered order through their wallet: no salary package, no tax or insurance, never on the salary run. New riders get it by default (the hire wizard skips the Pay step).",
     "To pay a rider a monthly salary instead, open their file, Pay tab, and switch it (salaries switch needed); then set their salary package as usual.",
     "A final deduction violation of a rider paid per delivery is taken from their wallet, not payroll: amounts as recorded, days at the store's day of rider pay (Accounting, Configuration).",
     "When a rider leaves, the settlement shows their wallet (available, on hold, owed); they settle with a last withdrawal."],
   "check": [
     "Riders do not appear in the payroll preview; their file shows Per delivered order on the Pay tab."],
   "problems": [
     "A rider shows as waiting for pay: their pay basis is monthly salary by mistake; switch it on the Pay tab."]},
  {"title": "طريقة دفع المناديب (شؤون العاملين)",
   "steps": [
     "المناديب بيقبضوا بالطلب المُسلَّم من خلال محفظتهم: من غير مرتب ولا ضرايب ولا تأمينات، وعمرهم ما بيكونوا على مسير المرتبات. المندوب الجديد بياخدها افتراضيًا (معالج التعيين بيتخطى خطوة الأجر).",
     "عشان تدفع لمندوب مرتب شهري بدل كده، افتح ملفه، تبويب الأجر، وحوّلها (محتاج صلاحية المرتبات)؛ وبعدين حدد باقة المرتب عادي.",
     "خصم مخالفة نهائية لمندوب بالطلب بيتاخد من محفظته مش من المسير: المبالغ زي ما اتسجلت، والأيام بقيمة يوم أجر المندوب للمخزن (إعدادات الحسابات).",
     "لما مندوب يمشي، التسوية بتوري محفظته (المتاح، المعلّق، اللي عليه)؛ ويقفل بآخر سحب."],
   "check": [
     "المناديب مش ظاهرين في معاينة المسير؛ وملفهم بيقول بالطلب المُسلَّم في تبويب الأجر."],
   "problems": [
     "مندوب ظاهر إنه مستني أجر: طريقة دفعه مرتب شهري بالغلط؛ حوّلها من تبويب الأجر."]})

# Accounting UX phase A (CLAUDE.md): the dashboard, list views, document pages, the one search.
_insert_after(
  "finance", "Cash position every morning", "موقف النقدية كل صبح",
  {"title": "Find and work your way around Accounting",
   "steps": [
     "Start every day on Accounting, Dashboard: the Today strip lists what waits for someone (approvals for you, payouts due today, rider withdrawals, cash differences, bank lines, bills due, entries missing a receipt, your reminders). Tap a line to open exactly those records.",
     "Each card below is one bank, cash box or book with its balance, the last 30 days and what waits; its buttons open the work (Match lines, Prepare payouts, New bill).",
     "Lists (Payouts, Bills, Journal, Cheques, Rider withdrawals, Approvals, Petty cash, Invoices): type in the search bar and press Enter, open Filters to pick ready filters and Group by (up to two, with subtotals), and remove a chip to undo it. The address keeps the view, so you can send it to a colleague.",
     "Save a view you use every day under Favourites; tick Open the list with it to make it your default.",
     "Columns chooses what the table shows; Export gives CSV or Excel of the filtered rows (only the ticked ones when you tick some).",
     "Tick rows to act on many at once: Approvals has Approve and Reject (a reason is needed), Payouts has Approve payouts. Each record is still checked: your own requests and payouts below the limit are refused and listed.",
     "A document page shows where it is, its buttons, and counts of what is linked (entries, payments, receipts, emails); tap one to open them. The arrows at the top walk the list you came from.",
     "On the right: write a note (it cannot be changed later), or Remind me on a day for you or a colleague; the reminder shows on the dashboard and on the phone when due. History lists every change.",
     "To find anything fast, type a number in the search at the top (PAY-12, BILL-3, JV-120, CHQ-4, RW-2, an order number) or a merchant's name."],
   "check": [
     "The Today strip is empty by the end of the day, or each line has a note or a reminder saying why."],
   "problems": [
     "A list looks empty: remove the filter chips; the list may open with a default filter (Approvals opens on Waiting).",
     "Bulk approve refused some records: read the reasons under the list; approve them one by one only when the rule allows it."]},
  {"title": "التنقل والشغل في الحسابات",
   "steps": [
     "ابدأ كل يوم من الحسابات، لوحة المتابعة: شريط النهارده بيعرض اللي مستني حد (موافقات ليك، دفعات مستحقة النهارده، سحوبات مناديب، فروق نقدية، سطور بنك، فواتير مستحقة، قيود من غير إيصال، تذكيراتك). دوس على السطر يفتحلك السجلات دي بالظبط.",
     "كل كارت تحت هو بنك أو خزنة أو دفتر برصيده وآخر 30 يوم واللي مستني؛ وزراره بتفتح الشغل (مطابقة السطور، إعداد الدفعات، فاتورة جديدة).",
     "القوائم (المدفوعات، الفواتير، اليومية، الشيكات، سحوبات المناديب، الموافقات، النثرية، الفواتير الضريبية): اكتب في البحث واضغط إنتر، افتح التصفية واختار فلاتر جاهزة وتجميع حسب (لحد اتنين بإجماليات)، وشيل أي شريحة عشان تلغيها. العنوان بيحفظ العرض، فتقدر تبعته لزميلك.",
     "احفظ العرض اللي بتستخدمه كل يوم في المفضلة؛ واختار افتح القائمة بيه عشان يبقى الافتراضي.",
     "الأعمدة بتختار اللي يظهر في الجدول؛ والتصدير بيطلع CSV أو إكسل للصفوف المفلترة (المحدد بس لو حددت).",
     "حدد صفوف عشان تشتغل على كذا واحد مرة واحدة: في الموافقات موافقة ورفض (لازم سبب)، وفي المدفوعات الموافقة على المدفوعات. كل سجل بيتراجع لوحده: طلباتك ودفعاتك تحت الحد بتترفض وتتكتب.",
     "صفحة المستند بتوري هو فين وزراره وعدد المرتبط بيه (قيود، دفعات، إيصالات، رسائل)؛ دوس على أي واحد يفتحهم. الأسهم فوق بتلف على القائمة اللي جيت منها.",
     "على الجنب: اكتب ملاحظة (ما تتغيرش بعد كده)، أو ذكّرني في يوم ليك أو لزميل؛ التذكير بيظهر في اللوحة وعلى الموبايل لما ييجي ميعاده. السجل بيعرض كل تغيير.",
     "عشان تلاقي أي حاجة بسرعة، اكتب رقم في البحث فوق (PAY-12 أو BILL-3 أو JV-120 أو CHQ-4 أو RW-2 أو رقم طلب) أو اسم تاجر."],
   "check": [
     "شريط النهارده فاضي آخر اليوم، أو كل سطر عليه ملاحظة أو تذكير بيقول ليه."],
   "problems": [
     "القائمة باينة فاضية: شيل شرائح التصفية؛ ممكن القائمة تفتح بفلتر افتراضي (الموافقات بتفتح على المنتظر).",
     "الموافقة الجماعية رفضت شوية سجلات: اقرا الأسباب تحت القائمة؛ ووافق عليهم واحد واحد بس لو القاعدة تسمح."]})

# Basata cash deposits (owner, 2026-11-11): riders deposit at a Basata branch; finance reviews
# the receipts, records Basata's daily transfer and unfreezes riders.
_insert_after(
  "rider", "Cash at the end of the shift", "الفلوس آخر الشيفت",
  {"title": "Deposit your cash at Basata",
   "steps": [
     "Go to a Basata branch with the cash you collected and deposit it.",
     "In the rider app tap Deposit at Basata: take a photo of the receipt, type the amount, the reference number on the receipt and when you deposited.",
     "Tap Send the deposit. It shows Waiting for review until accounting checks it.",
     "Hand in or deposit all your cash before the daily deadline shown on the screen (23:00 unless accounting says otherwise)."],
   "check": [
     "My deposits shows it as Waiting for review, then Approved.",
     "Cash to hand in went down by the amount."],
   "problems": [
     "Cash still with you after the deadline is taken from you (from your office or your wallet) and your account is frozen: deposit it at Basata and call accounting; only accounting unfreezes you.",
     "Refused: read the reason under the deposit, fix it and send it again with the right receipt.",
     "The reference was already sent: check the number on the receipt; never send one receipt twice."]},
  {"title": "إيداع الفلوس في بساطة",
   "steps": [
     "روح أي فرع بساطة بالفلوس اللي حصّلتها وأودعها.",
     "في تطبيق المندوب دوس إيداع في بساطة: صوّر الإيصال، واكتب المبلغ ورقم المرجع اللي على الإيصال ووقت الإيداع.",
     "دوس إرسال الإيداع. هيفضل في انتظار المراجعة لحد ما الحسابات تراجعه.",
     "سلّم أو أودع كل فلوسك قبل الموعد اليومي اللي ظاهر على الشاشة (11 بالليل إلا لو الحسابات قالت غير كده)."],
   "check": [
     "إيداعاتي بتوريه في انتظار المراجعة، وبعدين مقبول.",
     "النقدية المطلوب تسليمها نقصت بالمبلغ."],
   "problems": [
     "الفلوس اللي معاك بعد الموعد بتتخصم منك (من مكتبك أو من محفظتك) وحسابك بيتوقف: أودعها في بساطة وكلّم الحسابات؛ الحسابات بس هي اللي تلغي الإيقاف.",
     "اترفض: اقرا السبب تحت الإيداع، صلّح وابعته تاني بالإيصال الصح.",
     "المرجع اتبعت قبل كده: راجع الرقم اللي على الإيصال؛ عمرك ما تبعت نفس الإيصال مرتين."]})

_insert_after(
  "finance", "Cash position every morning", "موقف النقدية كل صبح",
  {"title": "Basata deposits, transfers and frozen riders",
   "steps": [
     "Cash and bank, Basata deposits opens on deposits waiting for review. Open each one: compare the receipt photo with the amount, the reference and the time, then Approve or Reject with a reason (at least 5 characters). Never decide your own.",
     "When Basata's daily transfer reaches the bank: Record Basata transfer, choose the bank (CIB), the day and the amount that arrived, keep ticked the deposits it covers. Basata's fee is the difference and is booked as an expense.",
     "Then match the bank line on Match the bank as usual.",
     "Frozen riders lists riders who still held cash after the daily deadline. Follow up with the rider and their office; Unfreeze only with a written reason once it is settled."],
   "check": [
     "No deposit waits for review by noon.",
     "At Basata on the cash position is only what Basata has not transferred yet."],
   "problems": [
     "The receipt does not match: Reject with the reason; after the deadline the cash is taken from the rider at once.",
     "The transfer is more than the deposits ticked: a deposit is missing; find it before recording."]},
  {"title": "إيداعات بساطة والتحويلات والمناديب الموقوفون",
   "steps": [
     "الكاش والبنك، إيداعات بساطة بتفتح على الإيداعات المستنية مراجعة. افتح كل واحد: قارن صورة الإيصال بالمبلغ والمرجع والوقت، وبعدين اقبل أو ارفض بسبب (5 حروف على الأقل). عمرك ما تقرر إيداعك.",
     "لما تحويل بساطة اليومي يوصل البنك: تسجيل تحويل بساطة، اختار البنك (CIB) واليوم والمبلغ اللي وصل، وسيب الإيداعات اللي بيغطيها متعلّم عليها. عمولة بساطة هي الفرق وبتتسجل مصروف.",
     "وبعدين طابق سطر البنك من مطابقة البنك زي العادة.",
     "المناديب الموقوفون بتعرض المناديب اللي كان معاهم فلوس بعد الموعد اليومي. تابع مع المندوب ومكتبه؛ وألغي الإيقاف بس بسبب مكتوب بعد ما الموضوع يتسوّى."],
   "check": [
     "مفيش إيداع مستني مراجعة لحد الضهر.",
     "لدى بساطة في موقف النقدية هو بس اللي بساطة لسه ما حوّلتوش."],
   "problems": [
     "الإيصال مش مطابق: ارفض بالسبب؛ بعد الموعد الفلوس بتتخصم من المندوب فورًا.",
     "التحويل أكبر من الإيداعات المتعلّم عليها: فيه إيداع ناقص؛ دوّر عليه قبل التسجيل."]})
