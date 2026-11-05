// Exit visuals have no interactive identity. SVG paint resources still need
// private IDs: removing a mask ID makes its currentColor rectangle paint solid.
export function prepareVisualSnapshot(nodes: Element[]) {
  const prefix = `visual-exit-${crypto.randomUUID()}-`;
  const resources = new Map<string, string>();
  for (const node of nodes) {
    const id = node.getAttribute('id');
    node.removeAttribute('id');
    if (id && node.namespaceURI === 'http://www.w3.org/2000/svg') {
      const replacement = prefix + resources.size;
      resources.set(id, replacement);
      node.setAttribute('id', replacement);
    }
    for (const name of ['role', 'name', 'autofocus']) node.removeAttribute(name);
  }
  for (const node of nodes) {
    for (const attribute of node.attributes) {
      const value = attribute.value.replace(
        /url\(\s*(['"]?)#([^\s)'" ]+)\1\s*\)/g,
        (reference, _quote, id) => (resources.has(id) ? `url(#${resources.get(id)})` : reference),
      );
      const linked =
        ['href', 'xlink:href'].includes(attribute.name) && value.startsWith('#')
          ? resources.get(value.slice(1))
          : undefined;
      if (linked || value !== attribute.value)
        node.setAttributeNS(attribute.namespaceURI, attribute.name, linked ? `#${linked}` : value);
    }
  }
}
