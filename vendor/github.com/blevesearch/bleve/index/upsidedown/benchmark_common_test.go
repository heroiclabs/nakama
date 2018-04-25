//  Copyright (c) 2014 Couchbase, Inc.
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

package upsidedown

import (
	"os"
	"strconv"
	"testing"

	_ "github.com/blevesearch/bleve/analysis/analyzer/standard"
	"github.com/blevesearch/bleve/document"
	"github.com/blevesearch/bleve/index"
	"github.com/blevesearch/bleve/registry"
)

var benchmarkDocBodies = []string{
	"A boiling liquid expanding vapor explosion (BLEVE, /ˈblɛviː/ blev-ee) is an explosion caused by the rupture of a vessel containing a pressurized liquid above its boiling point.",
	"A boiler explosion is a catastrophic failure of a boiler. As seen today, boiler explosions are of two kinds. One kind is a failure of the pressure parts of the steam and water sides. There can be many different causes, such as failure of the safety valve, corrosion of critical parts of the boiler, or low water level. Corrosion along the edges of lap joints was a common cause of early boiler explosions.",
	"A boiler is a closed vessel in which water or other fluid is heated. The fluid does not necessarily boil. (In North America the term \"furnace\" is normally used if the purpose is not actually to boil the fluid.) The heated or vaporized fluid exits the boiler for use in various processes or heating applications,[1][2] including central heating, boiler-based power generation, cooking, and sanitation.",
	"A pressure vessel is a closed container designed to hold gases or liquids at a pressure substantially different from the ambient pressure.",
	"Pressure (symbol: p or P) is the ratio of force to the area over which that force is distributed.",
	"Liquid is one of the four fundamental states of matter (the others being solid, gas, and plasma), and is the only state with a definite volume but no fixed shape.",
	"The boiling point of a substance is the temperature at which the vapor pressure of the liquid equals the pressure surrounding the liquid[1][2] and the liquid changes into a vapor.",
	"Vapor pressure or equilibrium vapor pressure is defined as the pressure exerted by a vapor in thermodynamic equilibrium with its condensed phases (solid or liquid) at a given temperature in a closed system.",
	"Industrial gases are a group of gases that are specifically manufactured for use in a wide range of industries, which include oil and gas, petrochemicals, chemicals, power, mining, steelmaking, metals, environmental protection, medicine, pharmaceuticals, biotechnology, food, water, fertilizers, nuclear power, electronics and aerospace.",
	"The expansion ratio of a liquefied and cryogenic substance is the volume of a given amount of that substance in liquid form compared to the volume of the same amount of substance in gaseous form, at room temperature and normal atmospheric pressure.",
}

type KVStoreDestroy func() error

func DestroyTest() error {
	return os.RemoveAll("test")
}

func CommonBenchmarkIndex(b *testing.B, storeName string, storeConfig map[string]interface{}, destroy KVStoreDestroy, analysisWorkers int) {

	cache := registry.NewCache()
	analyzer, err := cache.AnalyzerNamed("standard")
	if err != nil {
		b.Fatal(err)
	}

	indexDocument := document.NewDocument("").
		AddField(document.NewTextFieldWithAnalyzer("body", []uint64{}, []byte(benchmarkDocBodies[0]), analyzer))

	b.ResetTimer()
	b.StopTimer()
	for i := 0; i < b.N; i++ {
		analysisQueue := index.NewAnalysisQueue(analysisWorkers)
		idx, err := NewUpsideDownCouch(storeName, storeConfig, analysisQueue)
		if err != nil {
			b.Fatal(err)
		}

		err = idx.Open()
		if err != nil {
			b.Fatal(err)
		}
		indexDocument.ID = strconv.Itoa(i)
		// just time the indexing portion
		b.StartTimer()
		err = idx.Update(indexDocument)
		if err != nil {
			b.Fatal(err)
		}
		b.StopTimer()
		err = idx.Close()
		if err != nil {
			b.Fatal(err)
		}
		err = destroy()
		if err != nil {
			b.Fatal(err)
		}
		analysisQueue.Close()
	}
}

func CommonBenchmarkIndexBatch(b *testing.B, storeName string, storeConfig map[string]interface{}, destroy KVStoreDestroy, analysisWorkers, batchSize int) {

	cache := registry.NewCache()
	analyzer, err := cache.AnalyzerNamed("standard")
	if err != nil {
		b.Fatal(err)
	}

	b.ResetTimer()
	b.StopTimer()
	for i := 0; i < b.N; i++ {

		analysisQueue := index.NewAnalysisQueue(analysisWorkers)
		idx, err := NewUpsideDownCouch(storeName, storeConfig, analysisQueue)
		if err != nil {
			b.Fatal(err)
		}

		err = idx.Open()
		if err != nil {
			b.Fatal(err)
		}

		b.StartTimer()
		batch := index.NewBatch()
		for j := 0; j < 1000; j++ {
			if j%batchSize == 0 {
				if len(batch.IndexOps) > 0 {
					err := idx.Batch(batch)
					if err != nil {
						b.Fatal(err)
					}
				}
				batch = index.NewBatch()
			}
			indexDocument := document.NewDocument("").
				AddField(document.NewTextFieldWithAnalyzer("body", []uint64{}, []byte(benchmarkDocBodies[j%10]), analyzer))
			indexDocument.ID = strconv.Itoa(i) + "-" + strconv.Itoa(j)
			batch.Update(indexDocument)
		}
		// close last batch
		if len(batch.IndexOps) > 0 {
			err := idx.Batch(batch)
			if err != nil {
				b.Fatal(err)
			}
		}
		b.StopTimer()
		err = idx.Close()
		if err != nil {
			b.Fatal(err)
		}
		err = destroy()
		if err != nil {
			b.Fatal(err)
		}
		analysisQueue.Close()
	}
}
