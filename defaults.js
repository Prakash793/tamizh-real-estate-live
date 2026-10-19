// Tamil Nadu Regional Real Estate Visual Assets (CC0 / Permitted Unsplash Architecture & Agro Collections)
// Specifically curated to match Tamil Nadu / Chennai suburb visual reality:
// - Red soil & coconut groves for Farmland
// - Subdivided layout boundary stones & blacktop roads for Layouts
// - Contemporary South Indian villas with porticos & compound walls for Buildings
// - Highway frontage and land boundary marking for Promoting & Resell

const TN_DEFAULT_IMAGES = {
  "Layout": [
    "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1000&q=80", // Broad cleared land with boundary roads
    "https://images.unsplash.com/photo-1592595896551-12b371d546d5?auto=format&fit=crop&w=1000&q=80"  // Plotted township avenue
  ],
  "Building": [
    "https://images.unsplash.com/photo-1580587771525-78b9dba3b914?auto=format&fit=crop&w=1000&q=80", // South Indian style compound villa with balcony
    "https://images.unsplash.com/photo-1613490493576-7fde63acd811?auto=format&fit=crop&w=1000&q=80"
  ],
  "Farm land": [
    "https://images.unsplash.com/photo-1597916829826-02e5bb4a54e0?auto=format&fit=crop&w=1000&q=80", // Coconut palm grove and agricultural fields typical of Tamil Nadu
    "https://images.unsplash.com/photo-1544984243-ec57ea16fe25?auto=format&fit=crop&w=1000&q=80"  // Fertile greenery with irrigation
  ],
  "Promoting": [
    "https://images.unsplash.com/photo-1541888946425-d0fbb186c5f7?auto=format&fit=crop&w=1000&q=80", // Subdivided development parcel with road connectivity
    "https://images.unsplash.com/photo-1600585154340-be6161a56a0c?auto=format&fit=crop&w=1000&q=80"
  ],
  "Resell Promoting": [
    "https://images.unsplash.com/photo-1560518883-ce09059eeffa?auto=format&fit=crop&w=1000&q=80", // Verified independent residential property
    "https://images.unsplash.com/photo-1570129477492-45c003edd2be?auto=format&fit=crop&w=1000&q=80"
  ]
};

// Default Layout Blueprint / Masterplan Plan Map
const DEFAULT_LAYOUT_DOCUMENT = {
  title: "Sowbhagya Nagar Layout - DTCP Sanctioned Layout Plan",
  primaryImage: "https://images.unsplash.com/photo-1524813686514-a57563d77d61?auto=format&fit=crop&w=1200&q=80", // Clear architectural masterplan drawing
  gallery: [
    "https://images.unsplash.com/photo-1503387762-592deb58ef4e?auto=format&fit=crop&w=1200&q=80", // Site development map
    "https://images.unsplash.com/photo-1500382017468-9049fed747ef?auto=format&fit=crop&w=1200&q=80"  // Site on-ground boundary
  ],
  sanctionNumber: "DTCP / LP / 2024 / No. 84",
  locality: "Kayarambedu, Nellikuppam Main Road, Chengalpattu District",
  updatedAt: new Date().toISOString()
};

// Default 5 Service Panels (Ordered exactly per requirements)
const DEFAULT_SERVICE_PANELS = [
  {
    id: "panel_1",
    title: "Layout Promotion",
    shortDescription: "Promoting residential layouts and plots with clear property details and buyer enquiries.",
    description: "We help property owners promote residential layouts and individual plots by presenting property details, location advantages, plot dimensions, and available infrastructure. Our aim is to connect landowners with interested buyers and make property enquiries easier.",
    image: "/images/services/01_plot_promoting.jpg",
    isIllustrative: false,
    buttonText: "Explore Layouts",
    buttonLink: "#masterplan",
    categoryFilter: "Layout Promotion",
    displayOrder: 1,
    isEnabled: true
  },
  {
    id: "panel_2",
    title: "Buying & Selling Resale Plots",
    shortDescription: "Connecting buyers and sellers with suitable resale plots and property assistance.",
    description: "Whether you want to purchase a resale plot or sell land you already own, Tamizh Real Estate helps coordinate enquiries between buyers and sellers. We assist with understanding property details, comparing suitable options, arranging site visits, and progressing towards a transaction, subject to the necessary checks and agreements.",
    image: "/images/services/02_resale_plot_promoting.jpg",
    isIllustrative: false,
    buttonText: "Browse Resale Plots",
    buttonLink: "#listings",
    categoryFilter: "Buying & Selling Resale Plots",
    displayOrder: 2,
    isEnabled: true
  },
  {
    id: "panel_4",
    title: "Building Construction",
    shortDescription: "Guidance for residential homes, commercial buildings, and construction projects.",
    description: "From planning a new home to exploring residential or commercial building opportunities, we help customers understand their property requirements and identify suitable options. Construction services and project coordination can be tailored to the scope of each project, with applicable plans and approvals confirmed before work begins.",
    image: "/images/services/04_building.jpg",
    isIllustrative: false,
    buttonText: "Explore Building Services",
    buttonLink: "#listings",
    categoryFilter: "Building & Construction",
    displayOrder: 3,
    isEnabled: true
  },
  {
    id: "panel_3",
    title: "Farmland Development",
    shortDescription: "Exploring agricultural land opportunities and supporting property enquiries.",
    description: "Explore farmland opportunities and get assistance understanding land location, access, boundaries, and development potential. We help landowners present their properties and connect interested buyers with suitable agricultural land options, subject to applicable land-use rules and approvals.",
    image: "/images/services/03_farm_land_developing.jpg",
    isIllustrative: false,
    buttonText: "Explore Farmland",
    buttonLink: "#listings",
    categoryFilter: "Farmland Development",
    displayOrder: 4,
    isEnabled: true
  },
  {
    id: "panel_5",
    title: "Rental Homes & Flats",
    shortDescription: "Find rental homes and flats that match your location, budget, and needs.",
    description: "Looking for a house or flat to rent? We help connect tenants with suitable rental options based on preferred location, budget, property size, and requirements. We also assist property owners in presenting rental properties and coordinating enquiries, viewings, and discussions with prospective tenants.",
    image: "/images/services/05_rental_homes_flats.jpg",
    isIllustrative: false,
    buttonText: "Find Rental Properties",
    buttonLink: "#listings",
    categoryFilter: "Rental Homes & Flats",
    displayOrder: 5,
    isEnabled: true
  }
];

// Default Social Media & Official Office Contact Settings
const DEFAULT_SOCIAL_SETTINGS = {
  office: {
    addressLine1: "No. 01, Sowbhagya Nagar, Nellikuppam Main Road,",
    addressLine2: "Kayarambedu - 603 202, Chengalpattu District, Tamil Nadu.",
    phone1: "+91 98406 15219",
    phone2: "+91 86677 49580",
    email1: "tamizhrealestate@gmail.com",
    email2: "kulaas1973@gmail.com"
  },
  facebook: {
    url: "https://www.facebook.com/tamizhrealestate",
    isEnabled: false
  },
  instagram: {
    url: "https://www.instagram.com/tamizhrealestate",
    isEnabled: false
  }
};

function getDefaultImageForCategory(category) {
  const list = TN_DEFAULT_IMAGES[category] || TN_DEFAULT_IMAGES["Layout"];
  return list[0];
}

module.exports = {
  TN_DEFAULT_IMAGES,
  DEFAULT_LAYOUT_DOCUMENT,
  DEFAULT_SERVICE_PANELS,
  DEFAULT_SOCIAL_SETTINGS,
  getDefaultImageForCategory
};

