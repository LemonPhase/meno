// The model name, resolved once. Genkit needs it to pick a model and the
// Settings page needs to show it; a second copy of the default would drift
// on the next upgrade and quietly tell the user the wrong engine.
//
// Kept apart from ./genkit so reading the name costs nothing — importing
// ./genkit constructs the Vertex plugin, which a page that only prints a
// string has no business doing.
export const DEFAULT_MODEL = "vertexai/gemini-3.7-flash";

// "scripted" swaps in the test fake (see ./scripted); anything else is a
// Genkit model name served by the Vertex AI plugin.
export const modelName = process.env.MENO_MODEL ?? DEFAULT_MODEL;
