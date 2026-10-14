/**
 * The guide's content, kept apart from its markup so the writing can be read
 * and edited as writing. Each step is [screenshot, title, what to do, why].
 */

export const CREATE = [
['c1-passport-type', 'Say what kind of passport this is',
 'Pick <b>new vehicle</b> if the record starts at the factory, or <b>existing vehicle</b> if you are bringing a car that already has a history onto the register.',
 'The answer is itself a field on the chain, at slot 30. A record that begins at zero kilometres is a much stronger statement than one that begins mid-life, and a verifier is entitled to know which they are reading. Hiding that distinction would make every later claim harder to trust, so the passport carries it in the open.'],

['c2-vehicle', 'Choose a demonstration vehicle, or fill the form yourself',
 'The list is filtered by the passport type you just chose. Pick one and the fields below fill in, or ignore it and type your own.',
 'The demo fleet exists so you can walk the whole path without inventing plausible data, and every vehicle in it is fictional. If you are trying this with a real car, fill the form yourself. Nothing you type is sent anywhere until you press the button at the end.'],

['c3-identity', 'Enter the VIN and the identity fields',
 'The VIN, the registrar, a short description, the vehicle category and fuel type, and the battery passport identifier if the vehicle has one.',
 'The VIN is <b>hashed in your browser before anything leaves it</b>. That hash is the only vehicle identifier that ever reaches the chain, and every field slot is derived from it, which is why two vehicles can never collide and why reading the chain gives nobody a list of VINs. The battery identifier is the join to the battery passport, which becomes mandatory in February 2027, five years before this one does.'],

['c4-record', 'Record the values as they stand at registration',
 'Mileage, accident count, keepers, write-off category, service count. Enter what is true at the moment the record is created.',
 'These five go in under an <b>integrity rule that is fixed at creation and cannot be changed afterwards</b>: none of them may ever fall. That is the heart of the thing. A later write that would make the odometer smaller is not rejected by a server choosing to be strict. The circuit cannot produce a proof for it, so there is nothing to submit.'],

['c5-claims', 'Choose the claims to prove',
 'Tick the questions you want this passport to be able to answer. Each one becomes a separate proof.',
 'A claim is <b>a question with a bound, not a value</b>. Proving "no reported accidents" publishes the bound and a commitment; it never publishes the count. Tick only what a buyer will actually ask, because each claim is a real proof with a real cost, and an unasked question is better left unanswered than answered expensively.'],

['c6-where-and-run', 'Choose where it runs, then register and prove',
 'Local circuits run the real compiled contract on this machine, with no fees and no network. Preprod submits to the Midnight test network. Then press <b>REGISTER &amp; PROVE</b>.',
 'Both options run the same circuits, so a local run proves exactly the same things about the record. What it does not do is leave a public trace. Choose preprod only when you want that trace, because <b>those writes are permanent</b>: a VIN can never be registered twice, and a field is initialised once with its rule fixed at that moment.'],

['c7-result', 'Read what the circuits did',
 'Each row is one circuit call and whether the contract accepted it. The counter at the top right gives the totals.',
 'This is the record of the run, not a success banner. Had a claim been refused it would say so here, and <b>nothing would have been written for it</b>. That is the behaviour worth watching: a refusal leaves no transaction behind, because a proof that cannot be produced is never submitted. From here, <b>VIEW THIS PASSPORT</b> shows what a buyer would see.'],

['c8-code', 'Take the code and put it on the car',
 'The run produces a QR code for this vehicle. <b>COPY LINK</b> gives you the address; <b>DOWNLOAD THE CODE</b> gives you an SVG to print at any size. Put it on the windscreen, the service book, or the listing.',
 'This is the step that makes the record reachable by someone who is not sitting at your computer, and it is the mechanism the law names: Euro 7 <b>Article 7(4)</b> requires passport data to be available <b>through a QR code</b>, or a similar method. The code carries a link and the vehicle hash, nothing else. Anyone who photographs the sticker learns exactly what anyone reading the public ledger already knows, which is why it is safe to leave on a windscreen.']
];

export const VERIFY = [
['v10-code', 'Arrive by scanning the code on the car',
 'Point a phone camera at the code on the windscreen or the listing. The passport opens. There is nothing to install and nothing to sign up for.',
 'This is the normal way in, and the one the regulation has in mind: Euro 7 <b>Article 7(4)</b> requires the data to be reachable <b>through a QR code</b>, or a similar method. The same panel is on this page, so once you are here you can save the code, send it to a mechanic, or hand it to the next buyer. <b>The link carries only the vehicle hash</b>, which the ledger already publishes, so passing it on gives nothing away that was private.'],

['v11-find-by-vin', 'Or arrive with nothing but the VIN',
 'Type the 17 characters into <b>LOOK UP A VEHICLE BY VIN</b> and press <b>FIND THE PASSPORT</b>. Spaces, dashes and lower case are all accepted, because that is how a VIN is written down in real life.',
 'Not every buyer is standing at the car with a phone camera. A VIN copied from a listing, an invoice or a service book is enough to reach the record. The VIN is <b>hashed in this browser</b> and only the hash is used to look the passport up, so the VIN itself is never sent to a server, never stored, and never put in the address bar, where it would survive in a browser history or in any link that gets shared. Implementing Regulation (EU) 2025/1707 <b>Annex V, point 4.2.3</b> says the passport must not require the user to install software, register, or provide any data beyond the VIN. This box is that sentence, implemented literally.'],

['v12-not-found', 'See what happens when there is no record',
 'Type a VIN this ledger does not hold. The page says so and stops.',
 '<b>This is not a verdict on the vehicle.</b> A passport that was never issued cannot say anything about a car, good or bad, and a page that met an unknown VIN with anything resembling a clean bill of health would be worse than useless. So it names the three ordinary reasons, in the order they actually happen, and it does not imply the car is suspect. This is the same discipline the claim rows follow one level up: <b>absence is silence, not a denial</b>.'],

['v1-how-to-read', 'Read what the page is before you read the answer',
 'The block at the top says what this page is, who it is for, and what it does not do.',
 'A verdict with no stated scope is worth very little. This page is one buyer’s view of one vehicle, and saying so first is what lets the rest of it be read plainly.'],

['v2-verdict-head', 'Look at what identifies the vehicle',
 'The heading names the vehicle in human terms. Underneath it is the VIN hash.',
 'You are being shown <b>a hash, not a VIN</b>, and that is deliberate. The hash is what the chain holds. Hashing runs one way, so publishing it hands nobody the VIN, while still letting you confirm you are reading the record for the car in front of you.'],

['v3-claims', 'Read the four questions',
 'Each row is one question, with a tick where the record answers it and a dash where it does not.',
 'These are the questions a used-car buyer actually asks. The page puts the answer and the bound on the same line, so you see not only that the record answered but <b>exactly what it answered</b>. "Under 150,000 km" is a different statement from "under 10,000 km", and the row says which one was proven.'],

['v4-claim-open', 'Open one claim and read the proof',
 'Expand any row. You get the claim, the field key, the commitment it was proven against, and the ledger slot.',
 'This is the whole product in one box. A zero-knowledge proof was accepted on the ledger, and it could not have been produced unless the hidden value satisfied the bound. <b>The value is not here because it was never published.</b> You are not being asked to trust that we hide it carefully; it was never on the chain to hide.'],

['v8-caveat', 'Read what a tick does not mean',
 'The caveat sits on the page by default, not behind a link.',
 'A proof shows that the record says so, and that the record has not been changed since. It does not show that the record matched the physical car when it was written. <b>That is the registrar’s word</b>, which is why every passport names one, and why this page says so out loud rather than letting a tick imply more than it carries.'],

['v9-not-proven', 'Understand that not proven is not a no',
 'Open the second vehicle. Most of its rows say <b>not proven</b>.',
 'A failed proof writes nothing at all, so from outside, a claim nobody tried and a claim the record could not support look identical. The page therefore refuses to render silence as a denial. <b>Not proven is a question the seller has declined to answer</b>, and if the claim were true of the record, producing it would cost one transaction. Asking for it is reasonable.'],

['v5-chain-sees', 'Check what the chain actually holds',
 'Open <b>WHAT THE CHAIN SEES</b>. It lists every public value for this vehicle, and then everything that stays off the ledger.',
 'Most systems tell you what they protect. This one lists <b>what it publishes and what it does not</b>, in the same panel, because a verifier who reads silence as a denial is the exact failure this project exists to prevent. The VIN, every field value, the salts and the registrar’s secret are each named as absent rather than left to be worked out.'],

['v13-written-by', 'See who wrote each figure, not only that it holds',
 'Still inside <b>WHAT THE CHAIN SEES</b>, read the end of each claim row. It names the party that last wrote the field that claim was proven against.',
 'A car outlives whoever registered it. The manufacturer opens the passport, a dealership records the handover, a garage records the service, and a verifier is entitled to know which of them wrote the figure they are relying on. The registrar can hand the right to write <b>one vehicle</b> to another party and take it back again, and the circuit enforces that: a party who was never authorised cannot write, however the request is made. The mileage above was last written by the dealership rather than the manufacturer, and it still could not be made to fall, because <b>delegation hands over the pen, never the right to break the rule</b>. The rule was fixed when the field was created and applies to everyone who writes it afterwards.'],

['v6-summary', 'See who stands behind the record',
 'The summary names the registrar identity, counts the claims on the ledger, and says where the data came from.',
 'A passport that cannot say who wrote it is not worth checking. The registrar identity is <b>derived inside the circuit from a secret the registrar holds</b>, so the chain records who wrote the record without ever seeing how they proved it, and without anyone being able to write under an identity they do not hold.'],

['v7-proofs', 'Check it yourself, without us',
 'Open the proofs page for every claim on the ledger, or query the public indexer directly with the command the demo page gives you.',
 'Nothing above has to be taken on trust, which is the point of putting it on a chain at all. The contract is public, every transaction is public, and you can confirm that the claims resolve without asking us for permission and without an account.']
];
