// Presentation documents use the main window's shared coordinates.
const documents = new Set<Document>([document]);
export function presentationDocuments() {
  return [...documents];
}
export function registerPresentationDocument(value: Document) {
  documents.add(value);
  return () => documents.delete(value);
}
