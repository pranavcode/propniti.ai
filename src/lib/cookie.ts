// "; Secure" for cookies we set: in the browser when the page is https, on the server in
// production. Plain-http dev servers still get their cookies.
export const secureAttr = () => ((typeof location !== "undefined" ? location.protocol === "https:" : process.env.NODE_ENV === "production") ? "; Secure" : "");
