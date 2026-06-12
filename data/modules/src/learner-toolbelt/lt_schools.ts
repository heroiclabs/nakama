// lt_schools.ts
// ─────────────────────────────────────────────────────────────────────────────
// LearnerToolbelt — in-memory school fixture + search ranking (Wave 4 — PLAN § 6).
//
// Phase A ships an inline fixture of ~200 well-known schools across the
// 6 priority country groups. This is INTENTIONALLY a demo-grade subset —
// the full multi-million-row NCES/UDISE+/GIAS ingest lands in Phase B
// (per plan § 1.5 / § 7.2). The Phase A search RPC must still feel real
// for the SEO landing page + agent demos, so we bake well-known names.
//
// Fixture composition (target counts):
//   US: 30   India: 50   UK: 30   Singapore: 10   Brazil: 10
//   Other (FR/DE/UAE/JP/KR/AU/CA/MX/ZA/NG): 20
//   Generic placeholders: 50
//
// Ranking (plan § 6.4):
//   exact name match: 1000
//   prefix match:      800
//   substring match:   500
//   city match:       +200 boost
//   board exact:      +100 boost
//   country filter:   +50 boost (already passed → free)

namespace LearnerToolbelt {

  export interface SchoolRecord {
    school_id: string;
    source: string;
    display_name: string;
    city: string;
    state_region: string;
    country_code: string;
    board: string | null;
    grade_band: string;
    lat: number | null;
    lng: number | null;
    language_of_instruction: string | null;
    // "school" (K-12) or "college" (higher-ed / university). Defaulted on
    // every fixture row so the dual School & College Finder can filter and
    // badge results. Existing K-12 rows are minted via mk() → "school";
    // colleges/universities via mkCollege() → "college".
    institution_type: string;
  }

  function mk(id: string, source: string, name: string, city: string, region: string, country: string, board: string | null, band: string, lang: string | null): SchoolRecord {
    return {
      school_id: id, source: source, display_name: name,
      city: city, state_region: region, country_code: country,
      board: board, grade_band: band,
      lat: null, lng: null, language_of_instruction: lang,
      institution_type: "school",
    };
  }

  // College / university constructor. `system` slots into the `board` field
  // (e.g. "ivy-league", "iit", "iim", "russell-group", "go8") so the existing
  // board-aware ranking + UI subtitle keep working; grade_band is fixed to
  // "higher-ed".
  function mkCollege(id: string, source: string, name: string, city: string, region: string, country: string, system: string | null, lang: string | null): SchoolRecord {
    return {
      school_id: id, source: source, display_name: name,
      city: city, state_region: region, country_code: country,
      board: system, grade_band: "higher-ed",
      lat: null, lng: null, language_of_instruction: lang,
      institution_type: "college",
    };
  }

  // ── Fixture ──────────────────────────────────────────────────────────────
  export var SCHOOL_FIXTURE: SchoolRecord[] = [
    // ── US: 30 well-known public + magnet + private ──
    mk("nces:360008505860", "nces", "Stuyvesant High School", "New York", "NY", "US", "us-public", "hs-9-12", "en"),
    mk("nces:360008500700", "nces", "Bronx High School of Science", "Bronx", "NY", "US", "us-public", "hs-9-12", "en"),
    mk("nces:360008500692", "nces", "Brooklyn Technical High School", "Brooklyn", "NY", "US", "us-public", "hs-9-12", "en"),
    mk("nces:360011700301", "nces", "Hunter College High School", "New York", "NY", "US", "us-public", "hs-7-12", "en"),
    mk("nces:062271005932", "nces", "Lowell High School", "San Francisco", "CA", "US", "us-public", "hs-9-12", "en"),
    mk("nces:511821002859", "nces", "Thomas Jefferson High School for Science and Technology", "Alexandria", "VA", "US", "us-public", "hs-9-12", "en"),
    mk("nces:250456000316", "nces", "Boston Latin School", "Boston", "MA", "US", "us-public", "hs-7-12", "en"),
    mk("nces:170993006216", "nces", "Walter Payton College Preparatory High School", "Chicago", "IL", "US", "us-public", "hs-9-12", "en"),
    mk("nces:171449009381", "nces", "Northside College Preparatory High School", "Chicago", "IL", "US", "us-public", "hs-9-12", "en"),
    mk("nces:062271001995", "nces", "Gunn High School", "Palo Alto", "CA", "US", "us-public", "hs-9-12", "en"),
    mk("nces:062271001994", "nces", "Palo Alto High School", "Palo Alto", "CA", "US", "us-public", "hs-9-12", "en"),
    mk("nces:062271000570", "nces", "Mission San Jose High School", "Fremont", "CA", "US", "us-public", "hs-9-12", "en"),
    mk("nces:062271001500", "nces", "Monta Vista High School", "Cupertino", "CA", "US", "us-public", "hs-9-12", "en"),
    mk("nces:062271001501", "nces", "Lynbrook High School", "San Jose", "CA", "US", "us-public", "hs-9-12", "en"),
    mk("nces:200007000370", "nces", "Blue Valley North High School", "Overland Park", "KS", "US", "us-public", "hs-9-12", "en"),
    mk("nces:481680004186", "nces", "Plano West Senior High School", "Plano", "TX", "US", "us-public", "hs-11-12", "en"),
    mk("nces:481512004029", "nces", "Highland Park High School", "Dallas", "TX", "US", "us-public", "hs-9-12", "en"),
    mk("nces:482052005193", "nces", "Westwood High School", "Austin", "TX", "US", "us-public", "hs-9-12", "en"),
    mk("nces:340939003432", "nces", "High Technology High School", "Lincroft", "NJ", "US", "us-public", "hs-9-12", "en"),
    mk("nces:340939003433", "nces", "Bergen County Academies", "Hackensack", "NJ", "US", "us-public", "hs-9-12", "en"),
    mk("pss:0202790", "pss", "Phillips Exeter Academy", "Exeter", "NH", "US", "us-private", "hs-9-12", "en"),
    mk("pss:0202791", "pss", "Phillips Academy Andover", "Andover", "MA", "US", "us-private", "hs-9-12", "en"),
    mk("pss:0202792", "pss", "Choate Rosemary Hall", "Wallingford", "CT", "US", "us-private", "hs-9-12", "en"),
    mk("pss:0202793", "pss", "The Lawrenceville School", "Lawrenceville", "NJ", "US", "us-private", "hs-9-12", "en"),
    mk("pss:0202794", "pss", "Deerfield Academy", "Deerfield", "MA", "US", "us-private", "hs-9-12", "en"),
    mk("pss:0202795", "pss", "Hotchkiss School", "Lakeville", "CT", "US", "us-private", "hs-9-12", "en"),
    mk("pss:0202796", "pss", "St. Paul's School", "Concord", "NH", "US", "us-private", "hs-9-12", "en"),
    mk("pss:0202797", "pss", "Groton School", "Groton", "MA", "US", "us-private", "hs-9-12", "en"),
    mk("pss:0202798", "pss", "Trinity School", "New York", "NY", "US", "us-private", "k-12", "en"),
    mk("pss:0202799", "pss", "Horace Mann School", "Bronx", "NY", "US", "us-private", "k-12", "en"),

    // ── India: 50 top schools spanning Delhi/Mumbai/Bangalore/Chennai/Kolkata/Hyderabad ──
    mk("udise:09010012345", "udise", "Delhi Public School, R.K. Puram", "New Delhi", "Delhi", "IN", "cbse", "k-12", "en"),
    mk("udise:09010012346", "udise", "Delhi Public School, Vasant Kunj", "New Delhi", "Delhi", "IN", "cbse", "k-12", "en"),
    mk("udise:09010012347", "udise", "Delhi Public School, Mathura Road", "New Delhi", "Delhi", "IN", "cbse", "k-12", "en"),
    mk("udise:09010012348", "udise", "Sanskriti School", "New Delhi", "Delhi", "IN", "cbse", "k-12", "en"),
    mk("udise:09010012349", "udise", "Modern School, Barakhamba Road", "New Delhi", "Delhi", "IN", "cbse", "k-12", "en"),
    mk("udise:09010012350", "udise", "The Shri Ram School, Aravali", "Gurugram", "Haryana", "IN", "cbse", "k-12", "en"),
    mk("udise:09010012351", "udise", "Vasant Valley School", "New Delhi", "Delhi", "IN", "cbse", "k-12", "en"),
    mk("udise:09010012352", "udise", "Step by Step School", "Noida", "UP", "IN", "ib", "k-12", "en"),
    mk("udise:09010012353", "udise", "The Heritage School, Gurugram", "Gurugram", "Haryana", "IN", "cbse", "k-12", "en"),
    mk("udise:09010012354", "udise", "Pathways World School", "Gurugram", "Haryana", "IN", "ib", "k-12", "en"),

    mk("udise:27010023456", "udise", "Bombay Scottish School, Mahim", "Mumbai", "Maharashtra", "IN", "icse", "k-12", "en"),
    mk("udise:27010023457", "udise", "Cathedral and John Connon School", "Mumbai", "Maharashtra", "IN", "icse", "k-12", "en"),
    mk("udise:27010023458", "udise", "Dhirubhai Ambani International School", "Mumbai", "Maharashtra", "IN", "ib", "k-12", "en"),
    mk("udise:27010023459", "udise", "Campion School", "Mumbai", "Maharashtra", "IN", "icse", "hs-1-10", "en"),
    mk("udise:27010023460", "udise", "Bombay International School", "Mumbai", "Maharashtra", "IN", "icse", "k-12", "en"),
    mk("udise:27010023461", "udise", "Jamnabai Narsee School", "Mumbai", "Maharashtra", "IN", "cbse", "k-12", "en"),
    mk("udise:27010023462", "udise", "Hill Spring International School", "Mumbai", "Maharashtra", "IN", "ib", "k-12", "en"),
    mk("udise:27010023463", "udise", "Don Bosco High School, Matunga", "Mumbai", "Maharashtra", "IN", "icse", "hs-1-10", "en"),

    mk("udise:29010034567", "udise", "Bishop Cotton Boys' School", "Bangalore", "Karnataka", "IN", "icse", "k-12", "en"),
    mk("udise:29010034568", "udise", "Bishop Cotton Girls' School", "Bangalore", "Karnataka", "IN", "icse", "k-12", "en"),
    mk("udise:29010034569", "udise", "National Public School, Indiranagar", "Bangalore", "Karnataka", "IN", "cbse", "k-12", "en"),
    mk("udise:29010034570", "udise", "Bangalore International School", "Bangalore", "Karnataka", "IN", "ib", "k-12", "en"),
    mk("udise:29010034571", "udise", "Inventure Academy", "Bangalore", "Karnataka", "IN", "cambridge", "k-12", "en"),
    mk("udise:29010034572", "udise", "The Indus International School", "Bangalore", "Karnataka", "IN", "ib", "k-12", "en"),
    mk("udise:29010034573", "udise", "Christ Junior College", "Bangalore", "Karnataka", "IN", "state", "preuniv", "en"),

    mk("udise:33010045678", "udise", "Don Bosco Matriculation Hr Sec School", "Chennai", "TN", "IN", "state", "hs-1-12", "en"),
    mk("udise:33010045679", "udise", "PSBB Senior Secondary School, KK Nagar", "Chennai", "TN", "IN", "cbse", "k-12", "en"),
    mk("udise:33010045680", "udise", "Chettinad Vidyashram", "Chennai", "TN", "IN", "cbse", "k-12", "en"),
    mk("udise:33010045681", "udise", "DAV Boys Senior Secondary School", "Chennai", "TN", "IN", "cbse", "hs-1-12", "en"),
    mk("udise:33010045682", "udise", "The School KFI", "Chennai", "TN", "IN", "icse", "k-12", "en"),

    mk("udise:19010056789", "udise", "La Martiniere for Boys", "Kolkata", "WB", "IN", "icse", "hs-1-12", "en"),
    mk("udise:19010056790", "udise", "La Martiniere for Girls", "Kolkata", "WB", "IN", "icse", "hs-1-12", "en"),
    mk("udise:19010056791", "udise", "St. Xavier's Collegiate School", "Kolkata", "WB", "IN", "icse", "hs-1-12", "en"),
    mk("udise:19010056792", "udise", "Don Bosco School, Park Circus", "Kolkata", "WB", "IN", "icse", "hs-1-12", "en"),
    mk("udise:19010056793", "udise", "Modern High School for Girls", "Kolkata", "WB", "IN", "icse", "hs-1-12", "en"),
    mk("udise:19010056794", "udise", "South Point High School", "Kolkata", "WB", "IN", "icse", "hs-1-12", "en"),

    mk("udise:36010067890", "udise", "Hyderabad Public School, Begumpet", "Hyderabad", "Telangana", "IN", "icse", "hs-1-12", "en"),
    mk("udise:36010067891", "udise", "Chirec International School", "Hyderabad", "Telangana", "IN", "cbse", "k-12", "en"),
    mk("udise:36010067892", "udise", "Oakridge International School", "Hyderabad", "Telangana", "IN", "ib", "k-12", "en"),
    mk("udise:36010067893", "udise", "Delhi Public School, Nacharam", "Hyderabad", "Telangana", "IN", "cbse", "k-12", "en"),

    mk("udise:23010078901", "udise", "Daly College", "Indore", "MP", "IN", "icse", "hs-1-12", "en"),
    mk("udise:23010078902", "udise", "Emerald Heights International School", "Indore", "MP", "IN", "cbse", "k-12", "en"),
    mk("udise:08010089012", "udise", "Mayo College", "Ajmer", "Rajasthan", "IN", "cbse", "hs-1-12", "en"),
    mk("udise:08010089013", "udise", "The Doon School", "Dehradun", "Uttarakhand", "IN", "icse", "hs-7-12", "en"),
    mk("udise:08010089014", "udise", "Welham Boys' School", "Dehradun", "Uttarakhand", "IN", "icse", "hs-4-12", "en"),
    mk("udise:08010089015", "udise", "Scindia School", "Gwalior", "MP", "IN", "icse", "hs-6-12", "en"),
    mk("udise:08010089016", "udise", "Rishi Valley School", "Chittoor", "AP", "IN", "icse", "hs-4-12", "en"),

    mk("udise:09010012360", "udise", "Springdales School, Pusa Road", "New Delhi", "Delhi", "IN", "cbse", "k-12", "en"),
    mk("udise:09010012361", "udise", "Mother's International School", "New Delhi", "Delhi", "IN", "cbse", "k-12", "en"),
    mk("udise:27010023470", "udise", "Singapore International School, Mumbai", "Mumbai", "Maharashtra", "IN", "cambridge", "k-12", "en"),
    mk("udise:09010012362", "udise", "The British School, New Delhi", "New Delhi", "Delhi", "IN", "cambridge", "k-12", "en"),

    // ── UK: 30 well-known state + independent ──
    mk("gias-uk:100000", "gias-uk", "Eton College", "Windsor", "Berkshire", "UK", "uk-independent", "hs-9-13", "en"),
    mk("gias-uk:100001", "gias-uk", "Westminster School", "London", "Greater London", "UK", "uk-independent", "hs-7-13", "en"),
    mk("gias-uk:100002", "gias-uk", "Harrow School", "Harrow", "Greater London", "UK", "uk-independent", "hs-9-13", "en"),
    mk("gias-uk:100003", "gias-uk", "Winchester College", "Winchester", "Hampshire", "UK", "uk-independent", "hs-9-13", "en"),
    mk("gias-uk:100004", "gias-uk", "St Paul's School", "London", "Greater London", "UK", "uk-independent", "hs-7-13", "en"),
    mk("gias-uk:100005", "gias-uk", "Manchester Grammar School", "Manchester", "Greater Manchester", "UK", "uk-independent", "hs-7-13", "en"),
    mk("gias-uk:100006", "gias-uk", "City of London School", "London", "Greater London", "UK", "uk-independent", "hs-7-13", "en"),
    mk("gias-uk:100007", "gias-uk", "Dulwich College", "London", "Greater London", "UK", "uk-independent", "k-12", "en"),
    mk("gias-uk:100008", "gias-uk", "King's College School Wimbledon", "London", "Greater London", "UK", "uk-independent", "hs-7-13", "en"),
    mk("gias-uk:100009", "gias-uk", "St Paul's Girls' School", "London", "Greater London", "UK", "uk-independent", "hs-7-13", "en"),
    mk("gias-uk:100010", "gias-uk", "North London Collegiate School", "Edgware", "Greater London", "UK", "uk-independent", "k-12", "en"),
    mk("gias-uk:100011", "gias-uk", "Wycombe Abbey", "High Wycombe", "Buckinghamshire", "UK", "uk-independent", "hs-7-13", "en"),
    mk("gias-uk:100012", "gias-uk", "Cheltenham Ladies' College", "Cheltenham", "Gloucestershire", "UK", "uk-independent", "hs-7-13", "en"),
    mk("gias-uk:100013", "gias-uk", "Rugby School", "Rugby", "Warwickshire", "UK", "uk-independent", "hs-9-13", "en"),
    mk("gias-uk:100014", "gias-uk", "Marlborough College", "Marlborough", "Wiltshire", "UK", "uk-independent", "hs-9-13", "en"),
    mk("gias-uk:100015", "gias-uk", "The Perse School", "Cambridge", "Cambridgeshire", "UK", "uk-independent", "k-12", "en"),
    mk("gias-uk:100016", "gias-uk", "Henrietta Barnett School", "London", "Greater London", "UK", "uk-state", "hs-7-13", "en"),
    mk("gias-uk:100017", "gias-uk", "Queen Elizabeth's School, Barnet", "Barnet", "Greater London", "UK", "uk-state", "hs-7-13", "en"),
    mk("gias-uk:100018", "gias-uk", "Wilson's School", "Wallington", "Greater London", "UK", "uk-state", "hs-7-13", "en"),
    mk("gias-uk:100019", "gias-uk", "Tiffin Boys' School", "Kingston upon Thames", "Greater London", "UK", "uk-state", "hs-7-13", "en"),
    mk("gias-uk:100020", "gias-uk", "King Edward VI Camp Hill School", "Birmingham", "West Midlands", "UK", "uk-state", "hs-7-13", "en"),
    mk("gias-uk:100021", "gias-uk", "Pate's Grammar School", "Cheltenham", "Gloucestershire", "UK", "uk-state", "hs-7-13", "en"),
    mk("gias-uk:100022", "gias-uk", "Colchester Royal Grammar School", "Colchester", "Essex", "UK", "uk-state", "hs-7-13", "en"),
    mk("gias-uk:100023", "gias-uk", "The Tiffin Girls' School", "Kingston upon Thames", "Greater London", "UK", "uk-state", "hs-7-13", "en"),
    mk("gias-uk:100024", "gias-uk", "Newstead Wood School", "Orpington", "Greater London", "UK", "uk-state", "hs-7-13", "en"),
    mk("gias-uk:100025", "gias-uk", "Reading School", "Reading", "Berkshire", "UK", "uk-state", "hs-7-13", "en"),
    mk("gias-uk:100026", "gias-uk", "Oxford High School GDST", "Oxford", "Oxfordshire", "UK", "uk-independent", "k-12", "en"),
    mk("gias-uk:100027", "gias-uk", "Latymer School", "London", "Greater London", "UK", "uk-state", "hs-7-13", "en"),
    mk("gias-uk:100028", "gias-uk", "The Manchester Grammar School Junior", "Manchester", "Greater Manchester", "UK", "uk-independent", "primary", "en"),
    mk("gias-uk:100029", "gias-uk", "Royal Grammar School Guildford", "Guildford", "Surrey", "UK", "uk-independent", "hs-7-13", "en"),

    // ── Singapore: 10 ──
    mk("gias-sg:0001", "gias-sg", "Raffles Institution", "Singapore", "Central", "SG", "moe", "hs-7-12", "en"),
    mk("gias-sg:0002", "gias-sg", "Raffles Girls' School", "Singapore", "Central", "SG", "moe", "hs-7-10", "en"),
    mk("gias-sg:0003", "gias-sg", "Hwa Chong Institution", "Singapore", "Central", "SG", "moe", "hs-7-12", "en"),
    mk("gias-sg:0004", "gias-sg", "Nanyang Girls' High School", "Singapore", "Central", "SG", "moe", "hs-7-10", "en"),
    mk("gias-sg:0005", "gias-sg", "NUS High School of Mathematics and Science", "Singapore", "West", "SG", "moe", "hs-7-12", "en"),
    mk("gias-sg:0006", "gias-sg", "Anglo-Chinese School (Independent)", "Singapore", "Central", "SG", "moe", "hs-7-12", "en"),
    mk("gias-sg:0007", "gias-sg", "Methodist Girls' School", "Singapore", "West", "SG", "moe", "hs-7-10", "en"),
    mk("gias-sg:0008", "gias-sg", "Singapore Chinese Girls' School", "Singapore", "Central", "SG", "moe", "hs-7-10", "en"),
    mk("gias-sg:0009", "gias-sg", "Victoria Junior College", "Singapore", "East", "SG", "moe", "preuniv", "en"),
    mk("gias-sg:0010", "gias-sg", "Temasek Junior College", "Singapore", "East", "SG", "moe", "preuniv", "en"),

    // ── Brazil: 10 ──
    mk("inep:35001234", "inep", "Colégio Bandeirantes", "São Paulo", "SP", "BR", "br-private", "k-12", "pt"),
    mk("inep:35001235", "inep", "Colégio Etapa", "São Paulo", "SP", "BR", "br-private", "hs-6-12", "pt"),
    mk("inep:35001236", "inep", "Colégio Objetivo", "São Paulo", "SP", "BR", "br-private", "k-12", "pt"),
    mk("inep:35001237", "inep", "Colégio Móbile", "São Paulo", "SP", "BR", "br-private", "k-12", "pt"),
    mk("inep:35001238", "inep", "Colégio Vértice", "São Paulo", "SP", "BR", "br-private", "hs-6-12", "pt"),
    mk("inep:33001234", "inep", "Colégio Santo Agostinho", "Rio de Janeiro", "RJ", "BR", "br-private", "k-12", "pt"),
    mk("inep:33001235", "inep", "Colégio São Bento", "Rio de Janeiro", "RJ", "BR", "br-private", "hs-6-12", "pt"),
    mk("inep:33001236", "inep", "Escola Americana do Rio de Janeiro", "Rio de Janeiro", "RJ", "BR", "ib", "k-12", "en"),
    mk("inep:31001234", "inep", "Colégio Bernoulli", "Belo Horizonte", "MG", "BR", "br-private", "hs-6-12", "pt"),
    mk("inep:41001234", "inep", "Colégio Positivo", "Curitiba", "PR", "BR", "br-private", "k-12", "pt"),

    // ── Other: 20 (France, Germany, UAE, Japan, Korea, AU, CA, ZA, NG, MX) ──
    mk("freetext-seed:fr-001", "freetext", "Lycée Louis-le-Grand", "Paris", "Île-de-France", "FR", "fr-public", "hs-9-12", "fr"),
    mk("freetext-seed:fr-002", "freetext", "Lycée Henri-IV", "Paris", "Île-de-France", "FR", "fr-public", "hs-9-12", "fr"),
    mk("freetext-seed:fr-003", "freetext", "Lycée Stanislas", "Paris", "Île-de-France", "FR", "fr-private", "hs-9-12", "fr"),
    mk("freetext-seed:de-001", "freetext", "German European School Singapore", "Singapore", "West", "SG", "de-abitur", "k-12", "de"),
    mk("freetext-seed:de-002", "freetext", "Schadow-Gymnasium Berlin", "Berlin", "Berlin", "DE", "de-gymnasium", "hs-5-12", "de"),
    mk("freetext-seed:de-003", "freetext", "Vitzthum-Gymnasium Dresden", "Dresden", "Saxony", "DE", "de-gymnasium", "hs-5-12", "de"),
    mk("freetext-seed:ae-001", "freetext", "GEMS Modern Academy", "Dubai", "Dubai", "AE", "cbse", "k-12", "en"),
    mk("freetext-seed:ae-002", "freetext", "Dubai College", "Dubai", "Dubai", "AE", "uk-independent", "hs-7-13", "en"),
    mk("freetext-seed:ae-003", "freetext", "American School of Dubai", "Dubai", "Dubai", "AE", "us-private", "k-12", "en"),
    mk("freetext-seed:jp-001", "freetext", "Nada High School", "Kobe", "Hyogo", "JP", "jp-private", "hs-7-12", "ja"),
    mk("freetext-seed:jp-002", "freetext", "Kaisei Academy", "Tokyo", "Tokyo", "JP", "jp-private", "hs-7-12", "ja"),
    mk("freetext-seed:kr-001", "freetext", "Seoul Science High School", "Seoul", "Seoul", "KR", "kr-public", "hs-10-12", "ko"),
    mk("freetext-seed:kr-002", "freetext", "Daewon Foreign Language High School", "Seoul", "Seoul", "KR", "kr-public", "hs-10-12", "ko"),
    mk("freetext-seed:au-001", "freetext", "Melbourne Grammar School", "Melbourne", "Victoria", "AU", "au-independent", "k-12", "en"),
    mk("freetext-seed:au-002", "freetext", "Sydney Grammar School", "Sydney", "NSW", "AU", "au-independent", "k-12", "en"),
    mk("freetext-seed:ca-001", "freetext", "Upper Canada College", "Toronto", "Ontario", "CA", "ca-independent", "k-12", "en"),
    mk("freetext-seed:ca-002", "freetext", "St. George's School", "Vancouver", "BC", "CA", "ca-independent", "k-12", "en"),
    mk("freetext-seed:za-001", "freetext", "Bishops Diocesan College", "Cape Town", "Western Cape", "ZA", "za-independent", "k-12", "en"),
    mk("freetext-seed:ng-001", "freetext", "King's College Lagos", "Lagos", "Lagos", "NG", "ng-public", "hs-7-12", "en"),
    mk("freetext-seed:mx-001", "freetext", "Colegio Americano", "Mexico City", "CDMX", "MX", "mx-private", "k-12", "es"),
  ];

  // 50 generic placeholders so the picker always returns SOMETHING for the
  // long-tail country / city combinations the gateway will throw at it.
  (function seedGenericPlaceholders() {
    var GENERIC_COUNTRIES = [
      "AE", "AR", "AT", "BD", "BE", "BG", "CH", "CL", "CN", "CO",
      "CZ", "DK", "EG", "ES", "FI", "GR", "HU", "ID", "IE", "IL",
      "IT", "KE", "MY", "NL", "NO", "NZ", "PE", "PH", "PK", "PL",
      "PT", "QA", "RO", "RU", "SA", "SE", "SK", "TH", "TR", "TW",
      "UA", "UY", "VE", "VN", "ZA", "ZW", "BH", "JO", "KW", "LK",
    ];
    for (var i = 0; i < GENERIC_COUNTRIES.length; i++) {
      var cc = GENERIC_COUNTRIES[i];
      SCHOOL_FIXTURE.push(mk(
        "freetext-seed:" + cc.toLowerCase() + "-placeholder",
        "freetext",
        "(generic placeholder — " + cc + ")",
        "—",
        "—",
        cc,
        null,
        "k-12",
        null
      ));
    }
  })();

  // ── College / university fixture ───────────────────────────────────────────
  // Curated set of well-known higher-ed institutions across the same priority
  // country groups as the school fixture. Demo-grade subset (matching the K-12
  // approach) — the full IPEDS/AISHE/HESA ingest lands with the Phase-B school
  // ingest. `source` mirrors the authoritative registry per country.
  export var COLLEGE_FIXTURE: SchoolRecord[] = [
    // ── US: top universities (IPEDS) ──
    mkCollege("ipeds:166027", "ipeds", "Harvard University", "Cambridge", "MA", "US", "ivy-league", "en"),
    mkCollege("ipeds:166683", "ipeds", "Massachusetts Institute of Technology", "Cambridge", "MA", "US", "us-private", "en"),
    mkCollege("ipeds:243744", "ipeds", "Stanford University", "Stanford", "CA", "US", "us-private", "en"),
    mkCollege("ipeds:130794", "ipeds", "Yale University", "New Haven", "CT", "US", "ivy-league", "en"),
    mkCollege("ipeds:186131", "ipeds", "Princeton University", "Princeton", "NJ", "US", "ivy-league", "en"),
    mkCollege("ipeds:190150", "ipeds", "Columbia University", "New York", "NY", "US", "ivy-league", "en"),
    mkCollege("ipeds:110635", "ipeds", "University of California, Berkeley", "Berkeley", "CA", "US", "us-public", "en"),
    mkCollege("ipeds:110662", "ipeds", "University of California, Los Angeles", "Los Angeles", "CA", "US", "us-public", "en"),
    mkCollege("ipeds:170976", "ipeds", "University of Michigan", "Ann Arbor", "MI", "US", "us-public", "en"),
    mkCollege("ipeds:193900", "ipeds", "New York University", "New York", "NY", "US", "us-private", "en"),
    mkCollege("ipeds:144050", "ipeds", "University of Chicago", "Chicago", "IL", "US", "us-private", "en"),
    mkCollege("ipeds:110404", "ipeds", "California Institute of Technology", "Pasadena", "CA", "US", "us-private", "en"),
    mkCollege("ipeds:190415", "ipeds", "Cornell University", "Ithaca", "NY", "US", "ivy-league", "en"),
    mkCollege("ipeds:215062", "ipeds", "University of Pennsylvania", "Philadelphia", "PA", "US", "ivy-league", "en"),
    mkCollege("ipeds:217156", "ipeds", "Brown University", "Providence", "RI", "US", "ivy-league", "en"),
    mkCollege("ipeds:198419", "ipeds", "Duke University", "Durham", "NC", "US", "us-private", "en"),
    mkCollege("ipeds:147767", "ipeds", "Northwestern University", "Evanston", "IL", "US", "us-private", "en"),
    mkCollege("ipeds:162928", "ipeds", "Johns Hopkins University", "Baltimore", "MD", "US", "us-private", "en"),
    mkCollege("ipeds:211440", "ipeds", "Carnegie Mellon University", "Pittsburgh", "PA", "US", "us-private", "en"),
    mkCollege("ipeds:139755", "ipeds", "Georgia Institute of Technology", "Atlanta", "GA", "US", "us-public", "en"),
    mkCollege("ipeds:228778", "ipeds", "University of Texas at Austin", "Austin", "TX", "US", "us-public", "en"),
    mkCollege("ipeds:236948", "ipeds", "University of Washington", "Seattle", "WA", "US", "us-public", "en"),
    mkCollege("ipeds:145637", "ipeds", "University of Illinois Urbana-Champaign", "Champaign", "IL", "US", "us-public", "en"),
    mkCollege("ipeds:123961", "ipeds", "University of Southern California", "Los Angeles", "CA", "US", "us-private", "en"),
    mkCollege("ipeds:134130", "ipeds", "University of Florida", "Gainesville", "FL", "US", "us-public", "en"),
    mkCollege("ipeds:164988", "ipeds", "Boston University", "Boston", "MA", "US", "us-private", "en"),
    mkCollege("ipeds:243780", "ipeds", "Purdue University", "West Lafayette", "IN", "US", "us-public", "en"),
    mkCollege("ipeds:240444", "ipeds", "University of Wisconsin-Madison", "Madison", "WI", "US", "us-public", "en"),
    mkCollege("ipeds:204796", "ipeds", "Ohio State University", "Columbus", "OH", "US", "us-public", "en"),
    mkCollege("ipeds:104151", "ipeds", "Arizona State University", "Tempe", "AZ", "US", "us-public", "en"),

    // ── India: IITs, IIMs, central + top private (AISHE) ──
    mkCollege("aishe:U-0451", "aishe", "Indian Institute of Technology Bombay", "Mumbai", "Maharashtra", "IN", "iit", "en"),
    mkCollege("aishe:U-0452", "aishe", "Indian Institute of Technology Delhi", "New Delhi", "Delhi", "IN", "iit", "en"),
    mkCollege("aishe:U-0453", "aishe", "Indian Institute of Technology Madras", "Chennai", "TN", "IN", "iit", "en"),
    mkCollege("aishe:U-0454", "aishe", "Indian Institute of Technology Kanpur", "Kanpur", "UP", "IN", "iit", "en"),
    mkCollege("aishe:U-0455", "aishe", "Indian Institute of Technology Kharagpur", "Kharagpur", "WB", "IN", "iit", "en"),
    mkCollege("aishe:U-0456", "aishe", "Indian Institute of Technology Roorkee", "Roorkee", "Uttarakhand", "IN", "iit", "en"),
    mkCollege("aishe:U-0457", "aishe", "Indian Institute of Technology Guwahati", "Guwahati", "Assam", "IN", "iit", "en"),
    mkCollege("aishe:U-0458", "aishe", "Indian Institute of Technology Hyderabad", "Hyderabad", "Telangana", "IN", "iit", "en"),
    mkCollege("aishe:U-0460", "aishe", "Indian Institute of Science", "Bangalore", "Karnataka", "IN", "central", "en"),
    mkCollege("aishe:U-0461", "aishe", "All India Institute of Medical Sciences, Delhi", "New Delhi", "Delhi", "IN", "central", "en"),
    mkCollege("aishe:U-0462", "aishe", "University of Delhi", "New Delhi", "Delhi", "IN", "central", "en"),
    mkCollege("aishe:U-0463", "aishe", "Jawaharlal Nehru University", "New Delhi", "Delhi", "IN", "central", "en"),
    mkCollege("aishe:U-0464", "aishe", "Birla Institute of Technology and Science, Pilani", "Pilani", "Rajasthan", "IN", "deemed", "en"),
    mkCollege("aishe:U-0465", "aishe", "National Institute of Technology, Tiruchirappalli", "Tiruchirappalli", "TN", "IN", "nit", "en"),
    mkCollege("aishe:U-0466", "aishe", "Vellore Institute of Technology", "Vellore", "TN", "IN", "deemed", "en"),
    mkCollege("aishe:U-0467", "aishe", "Anna University", "Chennai", "TN", "IN", "state", "en"),
    mkCollege("aishe:U-0468", "aishe", "Jadavpur University", "Kolkata", "WB", "IN", "state", "en"),
    mkCollege("aishe:U-0469", "aishe", "University of Mumbai", "Mumbai", "Maharashtra", "IN", "state", "en"),
    mkCollege("aishe:U-0470", "aishe", "Manipal Academy of Higher Education", "Manipal", "Karnataka", "IN", "deemed", "en"),
    mkCollege("aishe:U-0471", "aishe", "SRM Institute of Science and Technology", "Chennai", "TN", "IN", "deemed", "en"),
    mkCollege("aishe:U-0472", "aishe", "Amity University", "Noida", "UP", "IN", "private", "en"),
    mkCollege("aishe:U-0473", "aishe", "Christ University", "Bangalore", "Karnataka", "IN", "deemed", "en"),
    mkCollege("aishe:U-0474", "aishe", "Ashoka University", "Sonipat", "Haryana", "IN", "private", "en"),
    mkCollege("aishe:U-0475", "aishe", "Shiv Nadar University", "Greater Noida", "UP", "IN", "private", "en"),
    mkCollege("aishe:C-0476", "aishe", "Lady Shri Ram College for Women", "New Delhi", "Delhi", "IN", "du-college", "en"),
    mkCollege("aishe:C-0477", "aishe", "St. Stephen's College", "New Delhi", "Delhi", "IN", "du-college", "en"),
    mkCollege("aishe:C-0478", "aishe", "Hindu College", "New Delhi", "Delhi", "IN", "du-college", "en"),
    mkCollege("aishe:C-0479", "aishe", "Loyola College", "Chennai", "TN", "IN", "autonomous", "en"),
    mkCollege("aishe:U-0480", "aishe", "Indian Institute of Management Ahmedabad", "Ahmedabad", "Gujarat", "IN", "iim", "en"),
    mkCollege("aishe:U-0481", "aishe", "Indian Institute of Management Bangalore", "Bangalore", "Karnataka", "IN", "iim", "en"),
    mkCollege("aishe:U-0482", "aishe", "Indian Institute of Management Calcutta", "Kolkata", "WB", "IN", "iim", "en"),

    // ── UK: Russell Group + top (HESA) ──
    mkCollege("hesa-uk:0001", "hesa-uk", "University of Oxford", "Oxford", "Oxfordshire", "UK", "russell-group", "en"),
    mkCollege("hesa-uk:0002", "hesa-uk", "University of Cambridge", "Cambridge", "Cambridgeshire", "UK", "russell-group", "en"),
    mkCollege("hesa-uk:0003", "hesa-uk", "Imperial College London", "London", "Greater London", "UK", "russell-group", "en"),
    mkCollege("hesa-uk:0004", "hesa-uk", "University College London", "London", "Greater London", "UK", "russell-group", "en"),
    mkCollege("hesa-uk:0005", "hesa-uk", "London School of Economics and Political Science", "London", "Greater London", "UK", "russell-group", "en"),
    mkCollege("hesa-uk:0006", "hesa-uk", "University of Edinburgh", "Edinburgh", "Scotland", "UK", "russell-group", "en"),
    mkCollege("hesa-uk:0007", "hesa-uk", "King's College London", "London", "Greater London", "UK", "russell-group", "en"),
    mkCollege("hesa-uk:0008", "hesa-uk", "University of Manchester", "Manchester", "Greater Manchester", "UK", "russell-group", "en"),
    mkCollege("hesa-uk:0009", "hesa-uk", "University of Warwick", "Coventry", "West Midlands", "UK", "russell-group", "en"),
    mkCollege("hesa-uk:0010", "hesa-uk", "University of Bristol", "Bristol", "Bristol", "UK", "russell-group", "en"),
    mkCollege("hesa-uk:0011", "hesa-uk", "University of Glasgow", "Glasgow", "Scotland", "UK", "russell-group", "en"),
    mkCollege("hesa-uk:0012", "hesa-uk", "Durham University", "Durham", "County Durham", "UK", "russell-group", "en"),
    mkCollege("hesa-uk:0013", "hesa-uk", "University of Birmingham", "Birmingham", "West Midlands", "UK", "russell-group", "en"),
    mkCollege("hesa-uk:0014", "hesa-uk", "University of Leeds", "Leeds", "West Yorkshire", "UK", "russell-group", "en"),
    mkCollege("hesa-uk:0015", "hesa-uk", "University of Sheffield", "Sheffield", "South Yorkshire", "UK", "russell-group", "en"),
    mkCollege("hesa-uk:0016", "hesa-uk", "University of Nottingham", "Nottingham", "Nottinghamshire", "UK", "russell-group", "en"),
    mkCollege("hesa-uk:0017", "hesa-uk", "University of Southampton", "Southampton", "Hampshire", "UK", "russell-group", "en"),
    mkCollege("hesa-uk:0018", "hesa-uk", "Queen Mary University of London", "London", "Greater London", "UK", "russell-group", "en"),
    mkCollege("hesa-uk:0019", "hesa-uk", "University of St Andrews", "St Andrews", "Scotland", "UK", "uk-ancient", "en"),
    mkCollege("hesa-uk:0020", "hesa-uk", "Lancaster University", "Lancaster", "Lancashire", "UK", "uk-public", "en"),

    // ── Singapore ──
    mkCollege("moe-sg-he:0001", "moe-sg", "National University of Singapore", "Singapore", "Central", "SG", "sg-autonomous", "en"),
    mkCollege("moe-sg-he:0002", "moe-sg", "Nanyang Technological University", "Singapore", "West", "SG", "sg-autonomous", "en"),
    mkCollege("moe-sg-he:0003", "moe-sg", "Singapore Management University", "Singapore", "Central", "SG", "sg-autonomous", "en"),
    mkCollege("moe-sg-he:0004", "moe-sg", "Singapore University of Technology and Design", "Singapore", "East", "SG", "sg-autonomous", "en"),
    mkCollege("moe-sg-he:0005", "moe-sg", "Singapore Institute of Technology", "Singapore", "Central", "SG", "sg-autonomous", "en"),

    // ── Brazil ──
    mkCollege("inep-he:0001", "inep", "Universidade de São Paulo", "São Paulo", "SP", "BR", "br-public", "pt"),
    mkCollege("inep-he:0002", "inep", "Universidade Estadual de Campinas", "Campinas", "SP", "BR", "br-public", "pt"),
    mkCollege("inep-he:0003", "inep", "Universidade Federal do Rio de Janeiro", "Rio de Janeiro", "RJ", "BR", "br-public", "pt"),
    mkCollege("inep-he:0004", "inep", "Universidade Estadual Paulista", "São Paulo", "SP", "BR", "br-public", "pt"),
    mkCollege("inep-he:0005", "inep", "Pontifícia Universidade Católica de São Paulo", "São Paulo", "SP", "BR", "br-private", "pt"),

    // ── Other (CA / AU / DE / FR / AE / JP / KR) ──
    mkCollege("freetext-seed:he-ca-001", "freetext", "University of Toronto", "Toronto", "Ontario", "CA", "ca-public", "en"),
    mkCollege("freetext-seed:he-ca-002", "freetext", "University of British Columbia", "Vancouver", "BC", "CA", "ca-public", "en"),
    mkCollege("freetext-seed:he-ca-003", "freetext", "McGill University", "Montreal", "Quebec", "CA", "ca-public", "en"),
    mkCollege("freetext-seed:he-ca-004", "freetext", "University of Waterloo", "Waterloo", "Ontario", "CA", "ca-public", "en"),
    mkCollege("freetext-seed:he-ca-005", "freetext", "University of Alberta", "Edmonton", "Alberta", "CA", "ca-public", "en"),
    mkCollege("freetext-seed:he-au-001", "freetext", "University of Melbourne", "Melbourne", "Victoria", "AU", "go8", "en"),
    mkCollege("freetext-seed:he-au-002", "freetext", "University of Sydney", "Sydney", "NSW", "AU", "go8", "en"),
    mkCollege("freetext-seed:he-au-003", "freetext", "Australian National University", "Canberra", "ACT", "AU", "go8", "en"),
    mkCollege("freetext-seed:he-au-004", "freetext", "University of New South Wales", "Sydney", "NSW", "AU", "go8", "en"),
    mkCollege("freetext-seed:he-au-005", "freetext", "Monash University", "Melbourne", "Victoria", "AU", "go8", "en"),
    mkCollege("freetext-seed:he-de-001", "freetext", "Technical University of Munich", "Munich", "Bavaria", "DE", "de-public", "de"),
    mkCollege("freetext-seed:he-de-002", "freetext", "Ludwig Maximilian University of Munich", "Munich", "Bavaria", "DE", "de-public", "de"),
    mkCollege("freetext-seed:he-de-003", "freetext", "Heidelberg University", "Heidelberg", "Baden-Württemberg", "DE", "de-public", "de"),
    mkCollege("freetext-seed:he-de-004", "freetext", "RWTH Aachen University", "Aachen", "North Rhine-Westphalia", "DE", "de-public", "de"),
    mkCollege("freetext-seed:he-fr-001", "freetext", "Sorbonne University", "Paris", "Île-de-France", "FR", "fr-public", "fr"),
    mkCollege("freetext-seed:he-fr-002", "freetext", "École Polytechnique", "Palaiseau", "Île-de-France", "FR", "fr-grande-ecole", "fr"),
    mkCollege("freetext-seed:he-fr-003", "freetext", "Sciences Po", "Paris", "Île-de-France", "FR", "fr-grande-ecole", "fr"),
    mkCollege("freetext-seed:he-ae-001", "freetext", "Khalifa University", "Abu Dhabi", "Abu Dhabi", "AE", "ae-public", "en"),
    mkCollege("freetext-seed:he-ae-002", "freetext", "American University of Sharjah", "Sharjah", "Sharjah", "AE", "ae-private", "en"),
    mkCollege("freetext-seed:he-jp-001", "freetext", "University of Tokyo", "Tokyo", "Tokyo", "JP", "jp-national", "ja"),
    mkCollege("freetext-seed:he-jp-002", "freetext", "Kyoto University", "Kyoto", "Kyoto", "JP", "jp-national", "ja"),
    mkCollege("freetext-seed:he-jp-003", "freetext", "Osaka University", "Osaka", "Osaka", "JP", "jp-national", "ja"),
    mkCollege("freetext-seed:he-jp-004", "freetext", "Tokyo Institute of Technology", "Tokyo", "Tokyo", "JP", "jp-national", "ja"),
    mkCollege("freetext-seed:he-kr-001", "freetext", "Seoul National University", "Seoul", "Seoul", "KR", "kr-national", "ko"),
    mkCollege("freetext-seed:he-kr-002", "freetext", "Korea Advanced Institute of Science and Technology", "Daejeon", "Daejeon", "KR", "kr-national", "ko"),
    mkCollege("freetext-seed:he-kr-003", "freetext", "Yonsei University", "Seoul", "Seoul", "KR", "kr-private", "ko"),
    mkCollege("freetext-seed:he-kr-004", "freetext", "Korea University", "Seoul", "Seoul", "KR", "kr-private", "ko"),

    // ── Geo-gap expansion (2026-06): top universities for every remaining
    // priority geo in the web COUNTRIES dropdown, so the "Colleges" filter
    // returns real institutions worldwide instead of only 12 countries.
    // Demo-grade curated rows (same as above) until the Phase-B registry
    // ingest; source stays "freetext" for non-registry countries.
    // ── Southeast & South Asia ──
    mkCollege("freetext-seed:he-id-001", "freetext", "Universitas Indonesia", "Depok", "West Java", "ID", "id-public", "id"),
    mkCollege("freetext-seed:he-id-002", "freetext", "Institut Teknologi Bandung", "Bandung", "West Java", "ID", "id-public", "id"),
    mkCollege("freetext-seed:he-id-003", "freetext", "Universitas Gadjah Mada", "Yogyakarta", "Yogyakarta", "ID", "id-public", "id"),
    mkCollege("freetext-seed:he-id-004", "freetext", "Institut Pertanian Bogor", "Bogor", "West Java", "ID", "id-public", "id"),
    mkCollege("freetext-seed:he-id-005", "freetext", "Universitas Airlangga", "Surabaya", "East Java", "ID", "id-public", "id"),
    mkCollege("freetext-seed:he-vn-001", "freetext", "Vietnam National University, Hanoi", "Hanoi", "Hanoi", "VN", "vn-public", "vi"),
    mkCollege("freetext-seed:he-vn-002", "freetext", "Vietnam National University, Ho Chi Minh City", "Ho Chi Minh City", "Ho Chi Minh", "VN", "vn-public", "vi"),
    mkCollege("freetext-seed:he-vn-003", "freetext", "Hanoi University of Science and Technology", "Hanoi", "Hanoi", "VN", "vn-public", "vi"),
    mkCollege("freetext-seed:he-th-001", "freetext", "Chulalongkorn University", "Bangkok", "Bangkok", "TH", "th-public", "th"),
    mkCollege("freetext-seed:he-th-002", "freetext", "Mahidol University", "Nakhon Pathom", "Bangkok Metro", "TH", "th-public", "th"),
    mkCollege("freetext-seed:he-th-003", "freetext", "Thammasat University", "Bangkok", "Bangkok", "TH", "th-public", "th"),
    mkCollege("freetext-seed:he-my-001", "freetext", "University of Malaya", "Kuala Lumpur", "KL", "MY", "my-public", "ms"),
    mkCollege("freetext-seed:he-my-002", "freetext", "Universiti Kebangsaan Malaysia", "Bangi", "Selangor", "MY", "my-public", "ms"),
    mkCollege("freetext-seed:he-my-003", "freetext", "Universiti Sains Malaysia", "George Town", "Penang", "MY", "my-public", "ms"),
    mkCollege("freetext-seed:he-my-004", "freetext", "Universiti Teknologi Malaysia", "Johor Bahru", "Johor", "MY", "my-public", "ms"),
    mkCollege("freetext-seed:he-ph-001", "freetext", "University of the Philippines Diliman", "Quezon City", "Metro Manila", "PH", "ph-public", "en"),
    mkCollege("freetext-seed:he-ph-002", "freetext", "Ateneo de Manila University", "Quezon City", "Metro Manila", "PH", "ph-private", "en"),
    mkCollege("freetext-seed:he-ph-003", "freetext", "De La Salle University", "Manila", "Metro Manila", "PH", "ph-private", "en"),
    mkCollege("freetext-seed:he-pk-001", "freetext", "Quaid-i-Azam University", "Islamabad", "Islamabad", "PK", "pk-public", "en"),
    mkCollege("freetext-seed:he-pk-002", "freetext", "Lahore University of Management Sciences", "Lahore", "Punjab", "PK", "pk-private", "en"),
    mkCollege("freetext-seed:he-pk-003", "freetext", "National University of Sciences and Technology", "Islamabad", "Islamabad", "PK", "pk-public", "en"),
    mkCollege("freetext-seed:he-pk-004", "freetext", "University of the Punjab", "Lahore", "Punjab", "PK", "pk-public", "en"),
    mkCollege("freetext-seed:he-bd-001", "freetext", "University of Dhaka", "Dhaka", "Dhaka", "BD", "bd-public", "bn"),
    mkCollege("freetext-seed:he-bd-002", "freetext", "Bangladesh University of Engineering and Technology", "Dhaka", "Dhaka", "BD", "bd-public", "bn"),
    mkCollege("freetext-seed:he-bd-003", "freetext", "North South University", "Dhaka", "Dhaka", "BD", "bd-private", "en"),
    mkCollege("freetext-seed:he-lk-001", "freetext", "University of Colombo", "Colombo", "Western", "LK", "lk-public", "en"),
    mkCollege("freetext-seed:he-lk-002", "freetext", "University of Peradeniya", "Kandy", "Central", "LK", "lk-public", "en"),
    mkCollege("freetext-seed:he-np-001", "freetext", "Tribhuvan University", "Kathmandu", "Bagmati", "NP", "np-public", "ne"),
    // ── East Asia ──
    mkCollege("freetext-seed:he-cn-001", "freetext", "Tsinghua University", "Beijing", "Beijing", "CN", "cn-c9", "zh"),
    mkCollege("freetext-seed:he-cn-002", "freetext", "Peking University", "Beijing", "Beijing", "CN", "cn-c9", "zh"),
    mkCollege("freetext-seed:he-cn-003", "freetext", "Fudan University", "Shanghai", "Shanghai", "CN", "cn-c9", "zh"),
    mkCollege("freetext-seed:he-cn-004", "freetext", "Shanghai Jiao Tong University", "Shanghai", "Shanghai", "CN", "cn-c9", "zh"),
    mkCollege("freetext-seed:he-cn-005", "freetext", "Zhejiang University", "Hangzhou", "Zhejiang", "CN", "cn-c9", "zh"),
    mkCollege("freetext-seed:he-hk-001", "freetext", "University of Hong Kong", "Hong Kong", "HK Island", "HK", "hk-public", "en"),
    mkCollege("freetext-seed:he-hk-002", "freetext", "Hong Kong University of Science and Technology", "Hong Kong", "Kowloon", "HK", "hk-public", "en"),
    mkCollege("freetext-seed:he-hk-003", "freetext", "Chinese University of Hong Kong", "Hong Kong", "New Territories", "HK", "hk-public", "en"),
    mkCollege("freetext-seed:he-tw-001", "freetext", "National Taiwan University", "Taipei", "Taipei", "TW", "tw-public", "zh"),
    mkCollege("freetext-seed:he-tw-002", "freetext", "National Tsing Hua University", "Hsinchu", "Hsinchu", "TW", "tw-public", "zh"),
    // ── Europe ──
    mkCollege("freetext-seed:he-es-001", "freetext", "Universidad Complutense de Madrid", "Madrid", "Madrid", "ES", "es-public", "es"),
    mkCollege("freetext-seed:he-es-002", "freetext", "Universitat de Barcelona", "Barcelona", "Catalonia", "ES", "es-public", "es"),
    mkCollege("freetext-seed:he-es-003", "freetext", "Universidad Autónoma de Madrid", "Madrid", "Madrid", "ES", "es-public", "es"),
    mkCollege("freetext-seed:he-es-004", "freetext", "Universitat Politècnica de Catalunya", "Barcelona", "Catalonia", "ES", "es-public", "es"),
    mkCollege("freetext-seed:he-it-001", "freetext", "Università di Bologna", "Bologna", "Emilia-Romagna", "IT", "it-public", "it"),
    mkCollege("freetext-seed:he-it-002", "freetext", "Sapienza Università di Roma", "Rome", "Lazio", "IT", "it-public", "it"),
    mkCollege("freetext-seed:he-it-003", "freetext", "Politecnico di Milano", "Milan", "Lombardy", "IT", "it-public", "it"),
    mkCollege("freetext-seed:he-it-004", "freetext", "Università degli Studi di Milano", "Milan", "Lombardy", "IT", "it-public", "it"),
    mkCollege("freetext-seed:he-nl-001", "freetext", "Delft University of Technology", "Delft", "South Holland", "NL", "nl-public", "en"),
    mkCollege("freetext-seed:he-nl-002", "freetext", "University of Amsterdam", "Amsterdam", "North Holland", "NL", "nl-public", "en"),
    mkCollege("freetext-seed:he-nl-003", "freetext", "Utrecht University", "Utrecht", "Utrecht", "NL", "nl-public", "en"),
    mkCollege("freetext-seed:he-nl-004", "freetext", "Leiden University", "Leiden", "South Holland", "NL", "nl-public", "en"),
    mkCollege("freetext-seed:he-se-001", "freetext", "KTH Royal Institute of Technology", "Stockholm", "Stockholm", "SE", "se-public", "en"),
    mkCollege("freetext-seed:he-se-002", "freetext", "Lund University", "Lund", "Skåne", "SE", "se-public", "en"),
    mkCollege("freetext-seed:he-se-003", "freetext", "Uppsala University", "Uppsala", "Uppsala", "SE", "se-public", "en"),
    mkCollege("freetext-seed:he-ch-001", "freetext", "ETH Zurich", "Zurich", "Zurich", "CH", "ch-federal", "en"),
    mkCollege("freetext-seed:he-ch-002", "freetext", "EPFL", "Lausanne", "Vaud", "CH", "ch-federal", "en"),
    mkCollege("freetext-seed:he-ch-003", "freetext", "University of Zurich", "Zurich", "Zurich", "CH", "ch-public", "de"),
    mkCollege("freetext-seed:he-ch-004", "freetext", "University of Geneva", "Geneva", "Geneva", "CH", "ch-public", "fr"),
    mkCollege("freetext-seed:he-at-001", "freetext", "University of Vienna", "Vienna", "Vienna", "AT", "at-public", "de"),
    mkCollege("freetext-seed:he-at-002", "freetext", "TU Wien", "Vienna", "Vienna", "AT", "at-public", "de"),
    mkCollege("freetext-seed:he-be-001", "freetext", "KU Leuven", "Leuven", "Flemish Brabant", "BE", "be-public", "nl"),
    mkCollege("freetext-seed:he-be-002", "freetext", "Ghent University", "Ghent", "East Flanders", "BE", "be-public", "nl"),
    mkCollege("freetext-seed:he-be-003", "freetext", "UCLouvain", "Louvain-la-Neuve", "Walloon Brabant", "BE", "be-public", "fr"),
    mkCollege("freetext-seed:he-dk-001", "freetext", "University of Copenhagen", "Copenhagen", "Capital Region", "DK", "dk-public", "en"),
    mkCollege("freetext-seed:he-dk-002", "freetext", "Technical University of Denmark", "Kongens Lyngby", "Capital Region", "DK", "dk-public", "en"),
    mkCollege("freetext-seed:he-dk-003", "freetext", "Aarhus University", "Aarhus", "Central Denmark", "DK", "dk-public", "en"),
    mkCollege("freetext-seed:he-fi-001", "freetext", "University of Helsinki", "Helsinki", "Uusimaa", "FI", "fi-public", "fi"),
    mkCollege("freetext-seed:he-fi-002", "freetext", "Aalto University", "Espoo", "Uusimaa", "FI", "fi-public", "en"),
    mkCollege("freetext-seed:he-no-001", "freetext", "University of Oslo", "Oslo", "Oslo", "NO", "no-public", "no"),
    mkCollege("freetext-seed:he-no-002", "freetext", "Norwegian University of Science and Technology", "Trondheim", "Trøndelag", "NO", "no-public", "no"),
    mkCollege("freetext-seed:he-pt-001", "freetext", "University of Lisbon", "Lisbon", "Lisbon", "PT", "pt-public", "pt"),
    mkCollege("freetext-seed:he-pt-002", "freetext", "University of Porto", "Porto", "Porto", "PT", "pt-public", "pt"),
    mkCollege("freetext-seed:he-gr-001", "freetext", "National and Kapodistrian University of Athens", "Athens", "Attica", "GR", "gr-public", "el"),
    mkCollege("freetext-seed:he-gr-002", "freetext", "Aristotle University of Thessaloniki", "Thessaloniki", "Central Macedonia", "GR", "gr-public", "el"),
    mkCollege("freetext-seed:he-pl-001", "freetext", "University of Warsaw", "Warsaw", "Masovia", "PL", "pl-public", "pl"),
    mkCollege("freetext-seed:he-pl-002", "freetext", "Jagiellonian University", "Kraków", "Lesser Poland", "PL", "pl-public", "pl"),
    mkCollege("freetext-seed:he-pl-003", "freetext", "Warsaw University of Technology", "Warsaw", "Masovia", "PL", "pl-public", "pl"),
    mkCollege("freetext-seed:he-cz-001", "freetext", "Charles University", "Prague", "Prague", "CZ", "cz-public", "cs"),
    mkCollege("freetext-seed:he-cz-002", "freetext", "Czech Technical University in Prague", "Prague", "Prague", "CZ", "cz-public", "cs"),
    mkCollege("freetext-seed:he-hu-001", "freetext", "Eötvös Loránd University", "Budapest", "Budapest", "HU", "hu-public", "hu"),
    mkCollege("freetext-seed:he-hu-002", "freetext", "Budapest University of Technology and Economics", "Budapest", "Budapest", "HU", "hu-public", "hu"),
    mkCollege("freetext-seed:he-ro-001", "freetext", "University of Bucharest", "Bucharest", "Bucharest", "RO", "ro-public", "ro"),
    mkCollege("freetext-seed:he-ro-002", "freetext", "Babeș-Bolyai University", "Cluj-Napoca", "Cluj", "RO", "ro-public", "ro"),
    mkCollege("freetext-seed:he-ru-001", "freetext", "Lomonosov Moscow State University", "Moscow", "Moscow", "RU", "ru-public", "ru"),
    mkCollege("freetext-seed:he-ru-002", "freetext", "Saint Petersburg State University", "Saint Petersburg", "Saint Petersburg", "RU", "ru-public", "ru"),
    mkCollege("freetext-seed:he-ru-003", "freetext", "Moscow Institute of Physics and Technology", "Dolgoprudny", "Moscow Oblast", "RU", "ru-public", "ru"),
    mkCollege("freetext-seed:he-ru-004", "freetext", "HSE University", "Moscow", "Moscow", "RU", "ru-public", "ru"),
    mkCollege("freetext-seed:he-ua-001", "freetext", "Taras Shevchenko National University of Kyiv", "Kyiv", "Kyiv", "UA", "ua-public", "uk"),
    mkCollege("freetext-seed:he-ua-002", "freetext", "Igor Sikorsky Kyiv Polytechnic Institute", "Kyiv", "Kyiv", "UA", "ua-public", "uk"),
    mkCollege("freetext-seed:he-ie-001", "freetext", "Trinity College Dublin", "Dublin", "Leinster", "IE", "ie-public", "en"),
    mkCollege("freetext-seed:he-ie-002", "freetext", "University College Dublin", "Dublin", "Leinster", "IE", "ie-public", "en"),
    mkCollege("freetext-seed:he-fr-004", "freetext", "Université Paris-Saclay", "Gif-sur-Yvette", "Île-de-France", "FR", "fr-public", "fr"),
    // ── Middle East & Central Asia ──
    mkCollege("freetext-seed:he-tr-001", "freetext", "Boğaziçi University", "Istanbul", "Istanbul", "TR", "tr-public", "tr"),
    mkCollege("freetext-seed:he-tr-002", "freetext", "Middle East Technical University", "Ankara", "Ankara", "TR", "tr-public", "en"),
    mkCollege("freetext-seed:he-tr-003", "freetext", "Istanbul Technical University", "Istanbul", "Istanbul", "TR", "tr-public", "tr"),
    mkCollege("freetext-seed:he-tr-004", "freetext", "Koç University", "Istanbul", "Istanbul", "TR", "tr-private", "en"),
    mkCollege("freetext-seed:he-il-001", "freetext", "Hebrew University of Jerusalem", "Jerusalem", "Jerusalem", "IL", "il-public", "he"),
    mkCollege("freetext-seed:he-il-002", "freetext", "Technion — Israel Institute of Technology", "Haifa", "Haifa", "IL", "il-public", "he"),
    mkCollege("freetext-seed:he-il-003", "freetext", "Tel Aviv University", "Tel Aviv", "Tel Aviv", "IL", "il-public", "he"),
    mkCollege("freetext-seed:he-sa-001", "freetext", "King Saud University", "Riyadh", "Riyadh", "SA", "sa-public", "ar"),
    mkCollege("freetext-seed:he-sa-002", "freetext", "King Fahd University of Petroleum and Minerals", "Dhahran", "Eastern Province", "SA", "sa-public", "en"),
    mkCollege("freetext-seed:he-sa-003", "freetext", "King Abdullah University of Science and Technology", "Thuwal", "Makkah", "SA", "sa-public", "en"),
    mkCollege("freetext-seed:he-qa-001", "freetext", "Qatar University", "Doha", "Doha", "QA", "qa-public", "ar"),
    mkCollege("freetext-seed:he-kw-001", "freetext", "Kuwait University", "Kuwait City", "Al Asimah", "KW", "kw-public", "ar"),
    mkCollege("freetext-seed:he-jo-001", "freetext", "University of Jordan", "Amman", "Amman", "JO", "jo-public", "ar"),
    mkCollege("freetext-seed:he-lb-001", "freetext", "American University of Beirut", "Beirut", "Beirut", "LB", "lb-private", "en"),
    mkCollege("freetext-seed:he-ae-003", "freetext", "United Arab Emirates University", "Al Ain", "Abu Dhabi", "AE", "ae-public", "en"),
    mkCollege("freetext-seed:he-ir-001", "freetext", "University of Tehran", "Tehran", "Tehran", "IR", "ir-public", "fa"),
    mkCollege("freetext-seed:he-ir-002", "freetext", "Sharif University of Technology", "Tehran", "Tehran", "IR", "ir-public", "fa"),
    mkCollege("freetext-seed:he-iq-001", "freetext", "University of Baghdad", "Baghdad", "Baghdad", "IQ", "iq-public", "ar"),
    mkCollege("freetext-seed:he-kz-001", "freetext", "Nazarbayev University", "Astana", "Astana", "KZ", "kz-autonomous", "en"),
    mkCollege("freetext-seed:he-kz-002", "freetext", "Al-Farabi Kazakh National University", "Almaty", "Almaty", "KZ", "kz-public", "kk"),
    mkCollege("freetext-seed:he-uz-001", "freetext", "National University of Uzbekistan", "Tashkent", "Tashkent", "UZ", "uz-public", "uz"),
    // ── Africa ──
    mkCollege("freetext-seed:he-eg-001", "freetext", "Cairo University", "Giza", "Giza", "EG", "eg-public", "ar"),
    mkCollege("freetext-seed:he-eg-002", "freetext", "American University in Cairo", "New Cairo", "Cairo", "EG", "eg-private", "en"),
    mkCollege("freetext-seed:he-eg-003", "freetext", "Ain Shams University", "Cairo", "Cairo", "EG", "eg-public", "ar"),
    mkCollege("freetext-seed:he-ma-001", "freetext", "Mohammed V University", "Rabat", "Rabat-Salé", "MA", "ma-public", "fr"),
    mkCollege("freetext-seed:he-ma-002", "freetext", "Al Akhawayn University", "Ifrane", "Fès-Meknès", "MA", "ma-private", "en"),
    mkCollege("freetext-seed:he-tn-001", "freetext", "University of Tunis", "Tunis", "Tunis", "TN", "tn-public", "fr"),
    mkCollege("freetext-seed:he-dz-001", "freetext", "University of Algiers", "Algiers", "Algiers", "DZ", "dz-public", "fr"),
    mkCollege("freetext-seed:he-ng-001", "freetext", "University of Lagos", "Lagos", "Lagos", "NG", "ng-public", "en"),
    mkCollege("freetext-seed:he-ng-002", "freetext", "University of Ibadan", "Ibadan", "Oyo", "NG", "ng-public", "en"),
    mkCollege("freetext-seed:he-ng-003", "freetext", "Ahmadu Bello University", "Zaria", "Kaduna", "NG", "ng-public", "en"),
    mkCollege("freetext-seed:he-ng-004", "freetext", "Covenant University", "Ota", "Ogun", "NG", "ng-private", "en"),
    mkCollege("freetext-seed:he-gh-001", "freetext", "University of Ghana", "Accra", "Greater Accra", "GH", "gh-public", "en"),
    mkCollege("freetext-seed:he-gh-002", "freetext", "Kwame Nkrumah University of Science and Technology", "Kumasi", "Ashanti", "GH", "gh-public", "en"),
    mkCollege("freetext-seed:he-ke-001", "freetext", "University of Nairobi", "Nairobi", "Nairobi", "KE", "ke-public", "en"),
    mkCollege("freetext-seed:he-ke-002", "freetext", "Kenyatta University", "Nairobi", "Nairobi", "KE", "ke-public", "en"),
    mkCollege("freetext-seed:he-ke-003", "freetext", "Strathmore University", "Nairobi", "Nairobi", "KE", "ke-private", "en"),
    mkCollege("freetext-seed:he-tz-001", "freetext", "University of Dar es Salaam", "Dar es Salaam", "Dar es Salaam", "TZ", "tz-public", "en"),
    mkCollege("freetext-seed:he-ug-001", "freetext", "Makerere University", "Kampala", "Central", "UG", "ug-public", "en"),
    mkCollege("freetext-seed:he-et-001", "freetext", "Addis Ababa University", "Addis Ababa", "Addis Ababa", "ET", "et-public", "en"),
    mkCollege("freetext-seed:he-za-001", "freetext", "University of Cape Town", "Cape Town", "Western Cape", "ZA", "za-public", "en"),
    mkCollege("freetext-seed:he-za-002", "freetext", "University of the Witwatersrand", "Johannesburg", "Gauteng", "ZA", "za-public", "en"),
    mkCollege("freetext-seed:he-za-003", "freetext", "Stellenbosch University", "Stellenbosch", "Western Cape", "ZA", "za-public", "en"),
    mkCollege("freetext-seed:he-za-004", "freetext", "University of Pretoria", "Pretoria", "Gauteng", "ZA", "za-public", "en"),
    mkCollege("freetext-seed:he-zw-001", "freetext", "University of Zimbabwe", "Harare", "Harare", "ZW", "zw-public", "en"),
    mkCollege("freetext-seed:he-zm-001", "freetext", "University of Zambia", "Lusaka", "Lusaka", "ZM", "zm-public", "en"),
    // ── Americas & Oceania ──
    mkCollege("freetext-seed:he-mx-001", "freetext", "Universidad Nacional Autónoma de México", "Mexico City", "CDMX", "MX", "mx-public", "es"),
    mkCollege("freetext-seed:he-mx-002", "freetext", "Tecnológico de Monterrey", "Monterrey", "Nuevo León", "MX", "mx-private", "es"),
    mkCollege("freetext-seed:he-mx-003", "freetext", "Instituto Politécnico Nacional", "Mexico City", "CDMX", "MX", "mx-public", "es"),
    mkCollege("freetext-seed:he-mx-004", "freetext", "Universidad de Guadalajara", "Guadalajara", "Jalisco", "MX", "mx-public", "es"),
    mkCollege("freetext-seed:he-ar-001", "freetext", "Universidad de Buenos Aires", "Buenos Aires", "CABA", "AR", "ar-public", "es"),
    mkCollege("freetext-seed:he-ar-002", "freetext", "Universidad Nacional de Córdoba", "Córdoba", "Córdoba", "AR", "ar-public", "es"),
    mkCollege("freetext-seed:he-cl-001", "freetext", "Pontificia Universidad Católica de Chile", "Santiago", "Santiago Metro", "CL", "cl-private", "es"),
    mkCollege("freetext-seed:he-cl-002", "freetext", "Universidad de Chile", "Santiago", "Santiago Metro", "CL", "cl-public", "es"),
    mkCollege("freetext-seed:he-co-001", "freetext", "Universidad Nacional de Colombia", "Bogotá", "Bogotá", "CO", "co-public", "es"),
    mkCollege("freetext-seed:he-co-002", "freetext", "Universidad de los Andes", "Bogotá", "Bogotá", "CO", "co-private", "es"),
    mkCollege("freetext-seed:he-pe-001", "freetext", "Pontificia Universidad Católica del Perú", "Lima", "Lima", "PE", "pe-private", "es"),
    mkCollege("freetext-seed:he-pe-002", "freetext", "Universidad Nacional Mayor de San Marcos", "Lima", "Lima", "PE", "pe-public", "es"),
    mkCollege("freetext-seed:he-uy-001", "freetext", "Universidad de la República", "Montevideo", "Montevideo", "UY", "uy-public", "es"),
    mkCollege("freetext-seed:he-ec-001", "freetext", "Universidad San Francisco de Quito", "Quito", "Pichincha", "EC", "ec-private", "es"),
    mkCollege("freetext-seed:he-ve-001", "freetext", "Universidad Central de Venezuela", "Caracas", "Capital District", "VE", "ve-public", "es"),
    mkCollege("freetext-seed:he-cr-001", "freetext", "Universidad de Costa Rica", "San José", "San José", "CR", "cr-public", "es"),
    mkCollege("freetext-seed:he-gt-001", "freetext", "Universidad de San Carlos de Guatemala", "Guatemala City", "Guatemala", "GT", "gt-public", "es"),
    mkCollege("freetext-seed:he-nz-001", "freetext", "University of Auckland", "Auckland", "Auckland", "NZ", "nz-public", "en"),
    mkCollege("freetext-seed:he-nz-002", "freetext", "University of Otago", "Dunedin", "Otago", "NZ", "nz-public", "en"),
    mkCollege("freetext-seed:he-nz-003", "freetext", "Victoria University of Wellington", "Wellington", "Wellington", "NZ", "nz-public", "en"),
  ];

  // Merge colleges into the single searchable fixture so getSchoolById and
  // searchSchools cover both institution types from one index.
  (function mergeColleges() {
    for (var ci = 0; ci < COLLEGE_FIXTURE.length; ci++) {
      SCHOOL_FIXTURE.push(COLLEGE_FIXTURE[ci]);
    }
  })();

  // ── Search ranking (plan § 6.4) ──────────────────────────────────────────
  export interface SchoolSearchHit {
    school_id: string;
    display_name: string;
    city: string;
    state_region: string;
    country_code: string;
    board: string | null;
    source: string;
    institution_type: string;
    score: number;
  }

  function normalize(s: string): string {
    // Lowercase, drop punctuation (so "R.K. Puram" → "rk puram"), collapse ws.
    return ("" + (s || "")).toLowerCase().replace(/[.,;:'"()]/g, "").replace(/\s+/g, " ").trim();
  }

  // Build an acronym from a normalized name. We take the first letter of each
  // token, EXCEPT for very short tokens (≤2 chars, e.g. "rk", "st") where we
  // include every letter — that way "delhi public school rk puram" → "dpsrkp"
  // and "dps rkp" (or "dpsrkp") matches via prefix.
  function acronymOf(normalizedName: string): string {
    var tokens = normalizedName.split(" ");
    var out = "";
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (!t) continue;
      if (t.length <= 2) {
        out += t;
      } else {
        out += t.charAt(0);
      }
    }
    return out;
  }

  // Strict acronym: first letter of each ≥3-char token, SKIPPING connective
  // tokens ("of", "de", "the", "and" all have ≤3 chars... we drop ≤2-char
  // tokens and the 3-char words "the"/"and") — this is how real-world
  // university acronyms are formed:
  //   "massachusetts institute of technology"      → "mit"
  //   "universidad nacional autónoma de méxico"    → "unam"
  //   "lahore university of management sciences"   → "lums"
  //   "hong kong university of science and technology" → "hkust"
  function acronymStrict(normalizedName: string): string {
    var tokens = normalizedName.split(" ");
    var out = "";
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (!t || t.length <= 2) continue;
      if (t === "the" || t === "and") continue;
      out += t.charAt(0);
    }
    return out;
  }

  // Tiny Levenshtein distance — bounded at maxDist so we can early-exit.
  function editDistance(a: string, b: string, maxDist: number): number {
    if (a === b) return 0;
    var aLen = a.length;
    var bLen = b.length;
    if (Math.abs(aLen - bLen) > maxDist) return maxDist + 1;
    if (aLen === 0) return bLen;
    if (bLen === 0) return aLen;
    var prev: number[] = [];
    for (var j = 0; j <= bLen; j++) prev.push(j);
    for (var i = 1; i <= aLen; i++) {
      var curr: number[] = [i];
      var rowMin = i;
      for (var k = 1; k <= bLen; k++) {
        var cost = a.charAt(i - 1) === b.charAt(k - 1) ? 0 : 1;
        var v = Math.min(curr[k - 1] + 1, prev[k] + 1, prev[k - 1] + cost);
        curr.push(v);
        if (v < rowMin) rowMin = v;
      }
      if (rowMin > maxDist) return maxDist + 1;
      prev = curr;
    }
    return prev[bLen];
  }

  // `institutionType` filters the index: "school" → K-12 only, "college" →
  // higher-ed only, "" / "all" / undefined → both (the dual-finder default).
  export function searchSchools(query: string, countryCode: string, limit: number, institutionType?: string): SchoolSearchHit[] {
    var q = normalize(query);
    var cc = ("" + (countryCode || "")).toUpperCase();
    // ISO-3166 says GB; the UK fixture rows (and some legacy callers) say UK.
    // Treat them as the same country so GB visitors actually see UK schools.
    if (cc === "GB") cc = "UK";
    var typeFilter = ("" + (institutionType || "")).toLowerCase();
    if (typeFilter === "all" || typeFilter === "any" || typeFilter === "both") typeFilter = "";
    var qTokens = q.split(/\s+/).filter(function (t) { return t.length > 0; });
    var hits: SchoolSearchHit[] = [];

    var qCompact = q.replace(/\s+/g, "");
    for (var i = 0; i < SCHOOL_FIXTURE.length; i++) {
      var rec = SCHOOL_FIXTURE[i];
      if (cc && rec.country_code !== cc) continue;
      if (typeFilter && rec.institution_type !== typeFilter) continue;
      var name = normalize(rec.display_name);
      var acro = acronymOf(name);
      var acroStrict = acronymStrict(name);
      var score = 0;

      if (name === q) {
        score = 1000;
      } else if (name.indexOf(q) === 0) {
        score = 800;
      } else if (q.length >= 2 && name.indexOf(q) > 0) {
        score = 500;
      } else if (
        qCompact.length >= 3 &&
        (acro === qCompact || acro.indexOf(qCompact) === 0 ||
         acroStrict === qCompact || acroStrict.indexOf(qCompact) === 0)
      ) {
        // Acronym match — covers "dpsrkp" → "Delhi Public School RK Puram",
        // "dps" → all DPS branches, "njc" → "Nanyang JC", and via the strict
        // variant "mit" / "unam" / "lums" / "kaist" / "hkust" / "unsw" etc.
        score = (acro === qCompact || acroStrict === qCompact) ? 850 : 600;
      } else {
        // Per-token substring or per-token acronym-substring.
        // "DPS RKP" (two tokens) → "dps" is the acronym of "delhi public school"
        // and "rkp" is the acronym of "rk puram" — match the suffix-acronym
        // by sliding through the name's per-word initials.
        var hits2 = 0;
        for (var t = 0; t < qTokens.length; t++) {
          var tok = qTokens[t];
          if (tok.length < 2) continue;
          if (name.indexOf(tok) >= 0) { hits2++; continue; }
          // Acronym slide: any window-of-tok.length over either acronym?
          if (tok.length <= acro.length && acro.indexOf(tok) >= 0) { hits2++; continue; }
          if (tok.length <= acroStrict.length && acroStrict.indexOf(tok) >= 0) hits2++;
        }
        if (hits2 === qTokens.length && qTokens.length > 0) {
          score = qTokens.length >= 2 ? 700 : 350;
        } else if (qTokens.length > 0 && hits2 >= Math.ceil(qTokens.length / 2)) {
          score = 200;
        } else if (q.length >= 3) {
          // Edit-distance fallback (≤2) only against name's first token.
          var firstNameToken = name.split(" ")[0] || "";
          var d = editDistance(q.slice(0, firstNameToken.length + 2), firstNameToken, 2);
          if (d <= 2) score = Math.max(score, 100);
        }
      }

      if (score === 0) continue;

      // City boost
      var city = normalize(rec.city);
      if (city && q.indexOf(city) >= 0) score += 200;

      // Country filter passed → +50 (free signal that the rec is relevant region)
      if (cc) score += 50;

      hits.push({
        school_id: rec.school_id,
        display_name: rec.display_name,
        city: rec.city,
        state_region: rec.state_region,
        country_code: rec.country_code,
        board: rec.board,
        source: rec.source,
        institution_type: rec.institution_type,
        score: score,
      });
    }

    hits.sort(function (a, b) { return b.score - a.score; });
    if (hits.length > limit) hits = hits.slice(0, limit);
    return hits;
  }

  export function getSchoolById(schoolId: string): SchoolRecord | null {
    for (var i = 0; i < SCHOOL_FIXTURE.length; i++) {
      if (SCHOOL_FIXTURE[i].school_id === schoolId) return SCHOOL_FIXTURE[i];
    }
    return null;
  }

  // ── Phase B: CockroachDB-backed index ──────────────────────────────────────
  //
  // The `lt_schools` table (loaded by content-factory/scripts/school_finder/
  // ingest_schools.py — Hipolabs global colleges + NCES/Urban-Institute US K-12
  // + GeoNames global schools/colleges, ~177k rows) is the real, comprehensive
  // index. The fixture above stays as a curated, always-present FALLBACK so the
  // tool never hard-fails on an empty DB (CI / fresh dev) and famous landmark
  // institutions (Eton, IIT-B, Stanford…) always resolve even where a public
  // dataset is sparse. At runtime we query the DB AND the fixture, then merge —
  // so loading data only ever ADDS coverage, never regresses curated hits.
  //
  // Table columns (must match ingest_schools.py COLUMNS):
  //   school_id, source, display_name, name_norm, acronym, city, state_region,
  //   country_code, level, board, grade_band, lat, lng, language, popularity
  // Note: the DB column is `level` ('school'|'college'); the fixture/web field
  // is `institution_type`. We map level → institution_type on the way out.

  // Strip SQL LIKE wildcards so user input can never inject a pattern. normalize()
  // already drops most punctuation; this also removes %, _ and backslash.
  function stripWildcards(s: string): string {
    return ("" + (s || "")).replace(/[%_\\]/g, "");
  }

  // Idempotent — safe to call on every server boot. Mirrors the find_friends
  // bootstrapDatabase() pattern: every statement is best-effort and never
  // crashes the runtime (the RPC degrades to the fixture if the table is
  // missing). The table is created here AND by the ETL runbook, whichever
  // runs first.
  export function bootstrapSchoolsTable(nk: nkruntime.Nakama, logger: nkruntime.Logger): void {
    var statements: { sql: string; label: string }[] = [
      {
        label: "table lt_schools",
        sql:
          "CREATE TABLE IF NOT EXISTS lt_schools (" +
          "  school_id    STRING PRIMARY KEY," +
          "  source       STRING NOT NULL," +
          "  display_name STRING NOT NULL," +
          "  name_norm    STRING NOT NULL," +
          "  acronym      STRING," +
          "  city         STRING," +
          "  state_region STRING," +
          "  country_code STRING NOT NULL," +
          "  level        STRING NOT NULL DEFAULT 'school'," +
          "  board        STRING," +
          "  grade_band   STRING," +
          "  lat          FLOAT8," +
          "  lng          FLOAT8," +
          "  language     STRING," +
          "  popularity   INT8 DEFAULT 0" +
          ")",
      },
      {
        label: "index idx_lt_schools_country_name",
        sql: "CREATE INDEX IF NOT EXISTS idx_lt_schools_country_name ON lt_schools (country_code, name_norm)",
      },
      {
        label: "index idx_lt_schools_country_acro",
        sql: "CREATE INDEX IF NOT EXISTS idx_lt_schools_country_acro ON lt_schools (country_code, acronym)",
      },
      {
        label: "index idx_lt_schools_level",
        sql: "CREATE INDEX IF NOT EXISTS idx_lt_schools_level ON lt_schools (level)",
      },
      {
        // Trigram GIN index makes `name_norm LIKE '%q%'` substring search fast on
        // ~177k rows. Native in CockroachDB v22.2+ (no extension needed). Best
        // effort — if unavailable the search still works via the btree indexes.
        label: "index idx_lt_schools_name_trgm",
        sql: "CREATE INDEX IF NOT EXISTS idx_lt_schools_name_trgm ON lt_schools USING GIN (name_norm gin_trgm_ops)",
      },
    ];
    for (var i = 0; i < statements.length; i++) {
      var stmt = statements[i];
      try {
        nk.sqlExec(stmt.sql, []);
        if (logger && logger.info) logger.info("[LearnerToolbelt] schools bootstrap OK: " + stmt.label);
      } catch (e: any) {
        var emsg = (e && (e.message || String(e))) || "unknown error";
        if (logger && logger.warn) {
          logger.warn("[LearnerToolbelt] schools bootstrap step '" + stmt.label +
            "' failed (non-fatal — search falls back to in-memory fixture): " + emsg);
        }
      }
    }
  }

  // DB-backed search. Returns [] on any error / empty table so the caller can
  // fall back to the fixture. Ranking mirrors the fixture's intent:
  //   exact 1000 > prefix 800 > acronym-exact 850 > acronym-prefix 600 >
  //   substring 500 > else 200, then + popularity + country-filter boost.
  export function searchSchoolsDB(nk: nkruntime.Nakama, query: string, countryCode: string, limit: number, institutionType?: string): SchoolSearchHit[] {
    if (!nk || typeof nk.sqlQuery !== "function") return [];
    var q = stripWildcards(normalize(query));
    if (!q) return [];
    var qCompact = q.replace(/\s+/g, "");
    // Only use the acronym branch for queries of 3+ chars (matches the fixture
    // and avoids 2-char acronym noise). Empty string disables that branch.
    var acro = qCompact.length >= 3 ? qCompact : "";
    var cc = ("" + (countryCode || "")).toUpperCase();
    var typeFilter = ("" + (institutionType || "")).toLowerCase();
    if (typeFilter === "all" || typeFilter === "any" || typeFilter === "both") typeFilter = "";

    var sql =
      "SELECT school_id, display_name, city, state_region, country_code, board, source, level, " +
      "  ( CASE " +
      "      WHEN name_norm = $1 THEN 1000 " +
      "      WHEN name_norm LIKE $1 || '%' THEN 800 " +
      "      WHEN $5 <> '' AND acronym = $5 THEN 850 " +
      "      WHEN $5 <> '' AND acronym LIKE $5 || '%' THEN 600 " +
      "      WHEN strpos(name_norm, $1) > 0 THEN 500 " +
      "      ELSE 200 END " +
      "    + COALESCE(popularity, 0) " +
      "    + CASE WHEN $2 <> '' THEN 50 ELSE 0 END ) AS score " +
      "FROM lt_schools " +
      "WHERE ($2 = '' OR country_code = $2) " +
      "  AND ($4 = '' OR level = $4) " +
      "  AND ( name_norm LIKE '%' || $1 || '%' " +
      "        OR ($5 <> '' AND acronym LIKE $5 || '%') ) " +
      "ORDER BY score DESC, COALESCE(popularity, 0) DESC, display_name ASC " +
      "LIMIT $3";

    var rows: any[];
    try {
      rows = nk.sqlQuery(sql, [q, cc, limit, typeFilter, acro]);
    } catch (e: any) {
      return [];
    }
    if (!rows || !rows.length) return [];
    var hits: SchoolSearchHit[] = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      hits.push({
        school_id: "" + r.school_id,
        display_name: "" + r.display_name,
        city: r.city ? "" + r.city : "",
        state_region: r.state_region ? "" + r.state_region : "",
        country_code: ("" + (r.country_code || "")).toUpperCase(),
        board: r.board ? "" + r.board : null,
        source: r.source ? "" + r.source : "db",
        institution_type: r.level ? "" + r.level : "school",
        score: parseInt("" + r.score, 10) || 0,
      });
    }
    return hits;
  }

  // Merge DB hits with fixture hits, dedupe by normalized (name + country),
  // keep the higher score, re-sort, cap at limit. Guarantees curated landmark
  // institutions survive even after the DB is loaded.
  export function mergeHits(primary: SchoolSearchHit[], secondary: SchoolSearchHit[], limit: number): SchoolSearchHit[] {
    var byKey: { [k: string]: SchoolSearchHit } = {};
    var merged: SchoolSearchHit[] = [];
    function add(h: SchoolSearchHit): void {
      var key = normalize(h.display_name) + "|" + ("" + (h.country_code || "")).toUpperCase();
      var existing = byKey[key];
      if (existing) {
        if (h.score > existing.score) existing.score = h.score;
        return;
      }
      byKey[key] = h;
      merged.push(h);
    }
    for (var i = 0; i < primary.length; i++) add(primary[i]);
    for (var j = 0; j < secondary.length; j++) add(secondary[j]);
    merged.sort(function (a, b) { return b.score - a.score; });
    if (merged.length > limit) merged = merged.slice(0, limit);
    return merged;
  }

  export function getSchoolByIdDB(nk: nkruntime.Nakama, schoolId: string): SchoolRecord | null {
    if (!nk || typeof nk.sqlQuery !== "function") return null;
    try {
      var rows: any[] = nk.sqlQuery(
        "SELECT school_id, source, display_name, city, state_region, country_code, " +
        "       board, grade_band, lat, lng, language, level " +
        "FROM lt_schools WHERE school_id = $1 LIMIT 1",
        [schoolId]
      );
      if (rows && rows.length) {
        var r = rows[0];
        return {
          school_id: "" + r.school_id,
          source: "" + (r.source || "db"),
          display_name: "" + r.display_name,
          city: r.city ? "" + r.city : "",
          state_region: r.state_region ? "" + r.state_region : "",
          country_code: ("" + (r.country_code || "")).toUpperCase(),
          board: r.board ? "" + r.board : null,
          grade_band: r.grade_band ? "" + r.grade_band : "",
          lat: (r.lat !== null && r.lat !== undefined && r.lat !== "") ? parseFloat("" + r.lat) : null,
          lng: (r.lng !== null && r.lng !== undefined && r.lng !== "") ? parseFloat("" + r.lng) : null,
          language_of_instruction: r.language ? "" + r.language : null,
          institution_type: r.level ? "" + r.level : "school",
        };
      }
    } catch (e: any) {
      return null;
    }
    return null;
  }

  // DB-first detail lookup with fixture fallback.
  export function getSchoolByIdAny(nk: nkruntime.Nakama, schoolId: string): SchoolRecord | null {
    var rec = getSchoolByIdDB(nk, schoolId);
    if (rec) return rec;
    return getSchoolById(schoolId);
  }
}
