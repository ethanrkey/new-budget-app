// The words the transaction form uses when you try to leave it.
//
// Same rule as the other files here: this is data, not a component.
// The phone shows it in a native alert; nothing else shows it yet,
// and when the web's form grows the same guard it will show this
// rather than a second sentence that means almost the same thing.
export const DISCARD = {
  title: "Discard changes?",
  // Named, not implied. "Are you sure?" makes somebody reconstruct
  // what they are being asked about; this says what is on the table.
  body: "This transaction hasn't been saved. Leaving now throws away what you typed.",
  keep: "Keep editing",
  discard: "Discard",
} as const;
