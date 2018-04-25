//  Copyright (c) 2015 Couchbase, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// 		http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package analysis_test

import (
	"testing"

	"github.com/blevesearch/bleve/analysis"
	"github.com/blevesearch/bleve/analysis/analyzer/standard"
	"github.com/blevesearch/bleve/registry"
)

func BenchmarkAnalysis(b *testing.B) {
	for i := 0; i < b.N; i++ {

		cache := registry.NewCache()
		analyzer, err := cache.AnalyzerNamed(standard.Name)
		if err != nil {
			b.Fatal(err)
		}

		ts := analyzer.Analyze(bleveWikiArticle)
		freqs := analysis.TokenFrequency(ts, nil, true)
		if len(freqs) != 511 {
			b.Errorf("expected %d freqs, got %d", 511, len(freqs))
		}
	}
}

var bleveWikiArticle = []byte(`Boiling liquid expanding vapor explosion
From Wikipedia, the free encyclopedia
See also: Boiler explosion and Steam explosion

Flames subsequent to a flammable liquid BLEVE from a tanker. BLEVEs do not necessarily involve fire.

This article's tone or style may not reflect the encyclopedic tone used on Wikipedia. See Wikipedia's guide to writing better articles for suggestions. (July 2013)
A boiling liquid expanding vapor explosion (BLEVE, /ˈblɛviː/ blev-ee) is an explosion caused by the rupture of a vessel containing a pressurized liquid above its boiling point.[1]
Contents  [hide]
1 Mechanism
1.1 Water example
1.2 BLEVEs without chemical reactions
2 Fires
3 Incidents
4 Safety measures
5 See also
6 References
7 External links
Mechanism[edit]

This section needs additional citations for verification. Please help improve this article by adding citations to reliable sources. Unsourced material may be challenged and removed. (July 2013)
There are three characteristics of liquids which are relevant to the discussion of a BLEVE:
If a liquid in a sealed container is boiled, the pressure inside the container increases. As the liquid changes to a gas it expands - this expansion in a vented container would cause the gas and liquid to take up more space. In a sealed container the gas and liquid are not able to take up more space and so the pressure rises. Pressurized vessels containing liquids can reach an equilibrium where the liquid stops boiling and the pressure stops rising. This occurs when no more heat is being added to the system (either because it has reached ambient temperature or has had a heat source removed).
The boiling temperature of a liquid is dependent on pressure - high pressures will yield high boiling temperatures, and low pressures will yield low boiling temperatures. A common simple experiment is to place a cup of water in a vacuum chamber, and then reduce the pressure in the chamber until the water boils. By reducing the pressure the water will boil even at room temperature. This works both ways - if the pressure is increased beyond normal atmospheric pressures, the boiling of hot water could be suppressed far beyond normal temperatures. The cooling system of a modern internal combustion engine is a real-world example.
When a liquid boils it turns into a gas. The resulting gas takes up far more space than the liquid did.
Typically, a BLEVE starts with a container of liquid which is held above its normal, atmospheric-pressure boiling temperature. Many substances normally stored as liquids, such as CO2, propane, and other similar industrial gases have boiling temperatures, at atmospheric pressure, far below room temperature. In the case of water, a BLEVE could occur if a pressurized chamber of water is heated far beyond the standard 100 °C (212 °F). That container, because the boiling water pressurizes it, is capable of holding liquid water at very high temperatures.
If the pressurized vessel, containing liquid at high temperature (which may be room temperature, depending on the substance) ruptures, the pressure which prevents the liquid from boiling is lost. If the rupture is catastrophic, where the vessel is immediately incapable of holding any pressure at all, then there suddenly exists a large mass of liquid which is at very high temperature and very low pressure. This causes the entire volume of liquid to instantaneously boil, which in turn causes an extremely rapid expansion. Depending on temperatures, pressures and the substance involved, that expansion may be so rapid that it can be classified as an explosion, fully capable of inflicting severe damage on its surroundings.
Water example[edit]
Imagine, for example, a tank of pressurized liquid water held at 204.4 °C (400 °F). This tank would normally be pressurized to 1.7 MPa (250 psi) above atmospheric ("gauge") pressure. If the tank containing the water were to rupture, there would for a slight moment exist a volume of liquid water which would be
at atmospheric pressure, and
204.4 °C (400 °F).
At atmospheric pressure the boiling point of water is 100 °C (212 °F) - liquid water at atmospheric pressure cannot exist at temperatures higher than 100 °C (212 °F). At that moment, the water would boil and turn to vapour explosively, and the 204.4 °C (400 °F) liquid water turned to gas would take up a lot more volume than it did as liquid, causing a vapour explosion. Such explosions can happen when the superheated water of a steam engine escapes through a crack in a boiler, causing a boiler explosion.
BLEVEs without chemical reactions[edit]
It is important to note that a BLEVE need not be a chemical explosion—nor does there need to be a fire—however if a flammable substance is subject to a BLEVE it may also be subject to intense heating, either from an external source of heat which may have caused the vessel to rupture in the first place or from an internal source of localized heating such as skin friction. This heating can cause a flammable substance to ignite, adding a secondary explosion caused by the primary BLEVE. While blast effects of any BLEVE can be devastating, a flammable substance such as propane can add significantly to the danger.
Bleve explosion.svg
While the term BLEVE is most often used to describe the results of a container of flammable liquid rupturing due to fire, a BLEVE can occur even with a non-flammable substance such as water,[2] liquid nitrogen,[3] liquid helium or other refrigerants or cryogens, and therefore is not usually considered a type of chemical explosion.
Fires[edit]
BLEVEs can be caused by an external fire near the storage vessel causing heating of the contents and pressure build-up. While tanks are often designed to withstand great pressure, constant heating can cause the metal to weaken and eventually fail. If the tank is being heated in an area where there is no liquid, it may rupture faster without the liquid to absorb the heat. Gas containers are usually equipped with relief valves that vent off excess pressure, but the tank can still fail if the pressure is not released quickly enough.[1] Relief valves are sized to release pressure fast enough to prevent the pressure from increasing beyond the strength of the vessel, but not so fast as to be the cause of an explosion. An appropriately sized relief valve will allow the liquid inside to boil slowly, maintaining a constant pressure in the vessel until all the liquid has boiled and the vessel empties.
If the substance involved is flammable, it is likely that the resulting cloud of the substance will ignite after the BLEVE has occurred, forming a fireball and possibly a fuel-air explosion, also termed a vapor cloud explosion (VCE). If the materials are toxic, a large area will be contaminated.[4]
Incidents[edit]
The term "BLEVE" was coined by three researchers at Factory Mutual, in the analysis of an accident there in 1957 involving a chemical reactor vessel.[5]
In August 1959 the Kansas City Fire Department suffered its largest ever loss of life in the line of duty, when a 25,000 gallon (95,000 litre) gas tank exploded during a fire on Southwest Boulevard killing five firefighters. This was the first time BLEVE was used to describe a burning fuel tank.[citation needed]
Later incidents included the Cheapside Street Whisky Bond Fire in Glasgow, Scotland in 1960; Feyzin, France in 1966; Crescent City, Illinois in 1970; Kingman, Arizona in 1973; a liquid nitrogen tank rupture[6] at Air Products and Chemicals and Mobay Chemical Company at New Martinsville, West Virginia on January 31, 1978 [1];Texas City, Texas in 1978; Murdock, Illinois in 1983; San Juan Ixhuatepec, Mexico City in 1984; and Toronto, Ontario in 2008.
Safety measures[edit]
[icon]	This section requires expansion. (July 2013)
Some fire mitigation measures are listed under liquefied petroleum gas.
See also[edit]
Boiler explosion
Expansion ratio
Explosive boiling or phase explosion
Rapid phase transition
Viareggio train derailment
2008 Toronto explosions
Gas carriers
Los Alfaques Disaster
Lac-Mégantic derailment
References[edit]
^ Jump up to: a b Kletz, Trevor (March 1990). Critical Aspects of Safety and Loss Prevention. London: Butterworth–Heinemann. pp. 43–45. ISBN 0-408-04429-2.
Jump up ^ "Temperature Pressure Relief Valves on Water Heaters: test, inspect, replace, repair guide". Inspect-ny.com. Retrieved 2011-07-12.
Jump up ^ Liquid nitrogen BLEVE demo
Jump up ^ "Chemical Process Safety" (PDF). Retrieved 2011-07-12.
Jump up ^ David F. Peterson, BLEVE: Facts, Risk Factors, and Fallacies, Fire Engineering magazine (2002).
Jump up ^ "STATE EX REL. VAPOR CORP. v. NARICK". Supreme Court of Appeals of West Virginia. 1984-07-12. Retrieved 2014-03-16.
External links[edit]
	Look up boiling liquid expanding vapor explosion in Wiktionary, the free dictionary.
	Wikimedia Commons has media related to BLEVE.
BLEVE Demo on YouTube — video of a controlled BLEVE demo
huge explosions on YouTube — video of propane and isobutane BLEVEs from a train derailment at Murdock, Illinois (3 September 1983)
Propane BLEVE on YouTube — video of BLEVE from the Toronto propane depot fire
Moscow Ring Road Accident on YouTube - Dozens of LPG tank BLEVEs after a road accident in Moscow
Kingman, AZ BLEVE — An account of the 5 July 1973 explosion in Kingman, with photographs
Propane Tank Explosions — Description of circumstances required to cause a propane tank BLEVE.
Analysis of BLEVE Events at DOE Sites - Details physics and mathematics of BLEVEs.
HID - SAFETY REPORT ASSESSMENT GUIDE: Whisky Maturation Warehouses - The liquor is aged in wooden barrels that can suffer BLEVE.
Categories: ExplosivesFirefightingFireTypes of fireGas technologiesIndustrial fires and explosions`)
