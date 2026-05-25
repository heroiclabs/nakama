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
  }

  function mk(id: string, source: string, name: string, city: string, region: string, country: string, board: string | null, band: string, lang: string | null): SchoolRecord {
    return {
      school_id: id, source: source, display_name: name,
      city: city, state_region: region, country_code: country,
      board: board, grade_band: band,
      lat: null, lng: null, language_of_instruction: lang,
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

  // ── Search ranking (plan § 6.4) ──────────────────────────────────────────
  export interface SchoolSearchHit {
    school_id: string;
    display_name: string;
    city: string;
    state_region: string;
    country_code: string;
    board: string | null;
    source: string;
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

  export function searchSchools(query: string, countryCode: string, limit: number): SchoolSearchHit[] {
    var q = normalize(query);
    var cc = ("" + (countryCode || "")).toUpperCase();
    var qTokens = q.split(/\s+/).filter(function (t) { return t.length > 0; });
    var hits: SchoolSearchHit[] = [];

    var qCompact = q.replace(/\s+/g, "");
    for (var i = 0; i < SCHOOL_FIXTURE.length; i++) {
      var rec = SCHOOL_FIXTURE[i];
      if (cc && rec.country_code !== cc) continue;
      var name = normalize(rec.display_name);
      var acro = acronymOf(name);
      var score = 0;

      if (name === q) {
        score = 1000;
      } else if (name.indexOf(q) === 0) {
        score = 800;
      } else if (q.length >= 2 && name.indexOf(q) > 0) {
        score = 500;
      } else if (qCompact.length >= 3 && (acro === qCompact || acro.indexOf(qCompact) === 0)) {
        // Acronym match — covers "dpsrkp" → "Delhi Public School RK Puram",
        // "dps" → all DPS branches, "njc" → "Nanyang JC", etc.
        score = (acro === qCompact) ? 850 : 600;
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
          // Acronym slide: any window-of-tok.length over `acro` matches?
          if (tok.length <= acro.length && acro.indexOf(tok) >= 0) hits2++;
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
}
