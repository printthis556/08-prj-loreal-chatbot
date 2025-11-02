// Small mapping of known L'Oréal product names to product URLs.
// The app will use this to auto-link product names when the assistant doesn't include a URL.
const productLinks = {
  // If an exact product page is not known, fallback to a Google site search
  // which reliably returns official product pages.
  "Revitalift Filler":
    "https://www.google.com/search?q=site:lorealparis.com+Revitalift+Filler",
  "Revitalift Hyaluronic Acid Serum":
    "https://www.google.com/search?q=site:lorealparis.com+Revitalift+Hyaluronic+Acid+Serum",
  "Solar Expertise SPF50":
    "https://www.google.com/search?q=site:lorealparis.com+Solar+Expertise+SPF50",
  "Elvive Dream Lengths":
    "https://www.google.com/search?q=site:lorealparis.com+Elvive+Dream+Lengths",
  "Elnett Satin Hairspray":
    "https://www.google.com/search?q=site:lorealparis.com+Elnett+Satin+Hairspray",
};
