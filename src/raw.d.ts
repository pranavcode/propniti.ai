// Text files imported with "?raw" (Vite natively; Turbopack via the rule in next.config.ts).
declare module "*.md?raw" {
  const content: string;
  export default content;
}
