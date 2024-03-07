// Copyright 2021 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package server

import (
	"fmt"
	"reflect"
	"strings"
	"time"

	"github.com/blugelabs/bluge"
	"github.com/blugelabs/bluge/analysis/analyzer"
	"github.com/blugelabs/bluge/search"
	"github.com/blugelabs/bluge/search/similarity"
	segment "github.com/blugelabs/bluge_segment_api"
	queryStr "github.com/blugelabs/query_string"
	"go.uber.org/zap"
)

type blugeMatch struct {
	ID     string
	Fields map[string]interface{}
}

type BlugeResult struct {
	Hits []*blugeMatch
}

func IterateBlugeMatches(dmi search.DocumentMatchIterator, loadFields map[string]struct{}, logger *zap.Logger) (*BlugeResult, error) {
	rv := &BlugeResult{}
	dm, err := dmi.Next()
	for dm != nil && err == nil {
		var bm blugeMatch
		bm.Fields = make(map[string]interface{})
		err = dm.VisitStoredFields(func(field string, value []byte) bool {
			if field == "_id" {
				bm.ID = string(value)
			}
			if _, ok := loadFields[field]; ok {
				if field == "tick_rate" {
					// hard-coded numeric decoding
					bm.Fields[field], err = bluge.DecodeNumericFloat64(value)
					if err != nil {
						logger.Warn("error decoding numeric value: %v", zap.Error(err))
					}
				} else {
					bm.Fields[field] = string(value)
				}
			}

			return true
		})
		if err != nil {
			return nil, fmt.Errorf("error visiting stored field: %v", err.Error())
		}
		rv.Hits = append(rv.Hits, &bm)
		dm, err = dmi.Next()
	}
	if err != nil {
		return nil, fmt.Errorf("error iterating document matches: %v", err.Error())
	}

	return rv, nil
}

func BlugeWalkDocument(data interface{}, path []string, sortablePaths map[string]bool, doc *bluge.Document) {
	val := reflect.ValueOf(data)
	if !val.IsValid() {
		return
	}

	typ := val.Type()
	switch typ.Kind() {
	case reflect.Map:
		if typ.Key().Kind() == reflect.String {
			for _, key := range val.MapKeys() {
				fieldName := key.String()
				fieldVal := val.MapIndex(key).Interface()
				blugeProcessProperty(fieldVal, append(path, fieldName), sortablePaths, doc)
			}
		}
	case reflect.Struct:
		for i := 0; i < val.NumField(); i++ {
			field := typ.Field(i)
			fieldName := field.Name
			// anonymous fields of type struct can elide the type name
			if field.Anonymous && field.Type.Kind() == reflect.Struct {
				fieldName = ""
			}

			// if the field has a name under the specified tag, prefer that
			tag := field.Tag.Get("json")
			tagFieldName := blugeParseTagName(tag)
			if tagFieldName == "-" {
				continue
			}
			// allow tag to set field name to empty, only if anonymous
			if field.Tag != "" && (tagFieldName != "" || field.Anonymous) {
				fieldName = tagFieldName
			}

			if val.Field(i).CanInterface() {
				fieldVal := val.Field(i).Interface()
				newpath := path
				if fieldName != "" {
					newpath = append(path, fieldName)
				}
				blugeProcessProperty(fieldVal, newpath, sortablePaths, doc)
			}
		}
	case reflect.Slice, reflect.Array:
		for i := 0; i < val.Len(); i++ {
			if val.Index(i).CanInterface() {
				fieldVal := val.Index(i).Interface()
				blugeProcessProperty(fieldVal, path, sortablePaths, doc)
			}
		}
	case reflect.Ptr:
		ptrElem := val.Elem()
		if ptrElem.IsValid() && ptrElem.CanInterface() {
			blugeProcessProperty(ptrElem.Interface(), path, sortablePaths, doc)
		}
	case reflect.String:
		blugeProcessProperty(val.String(), path, sortablePaths, doc)
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		blugeProcessProperty(float64(val.Int()), path, sortablePaths, doc)
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		blugeProcessProperty(float64(val.Uint()), path, sortablePaths, doc)
	case reflect.Float32, reflect.Float64:
		blugeProcessProperty(float64(val.Float()), path, sortablePaths, doc)
	case reflect.Bool:
		blugeProcessProperty(val.Bool(), path, sortablePaths, doc)
	}
}

func blugeProcessProperty(property interface{}, path []string, sortablePaths map[string]bool, doc *bluge.Document) {
	pathString := strings.Join(path, ".")

	propertyValue := reflect.ValueOf(property)
	if !propertyValue.IsValid() {
		// cannot do anything with the zero value
		return
	}
	propertyType := propertyValue.Type()
	switch propertyType.Kind() {
	case reflect.String:
		propertyValueString := propertyValue.String()

		// automatic indexing behavior
		// first see if it can be parsed as a date
		parsedDateTime, err := blugeParseDateTime(propertyValueString)
		if err != nil {
			// index as text
			field := bluge.NewKeywordField(pathString, propertyValueString)
			if sortablePaths[pathString] {
				field.Sortable()
			}
			doc.AddField(field)
		} else {
			// index as datetime
			field := bluge.NewDateTimeField(pathString, parsedDateTime)
			if sortablePaths[pathString] {
				field.Sortable()
			}
			doc.AddField(field)
		}

	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		blugeProcessProperty(float64(propertyValue.Int()), path, sortablePaths, doc)
		return
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64:
		blugeProcessProperty(float64(propertyValue.Uint()), path, sortablePaths, doc)
		return
	case reflect.Float64, reflect.Float32:
		propertyValFloat := propertyValue.Float()

		// automatic indexing behavior
		field := bluge.NewNumericField(pathString, propertyValFloat)
		if sortablePaths[pathString] {
			field.Sortable()
		}
		doc.AddField(field)

	case reflect.Bool:
		propertyValBool := propertyValue.Bool()

		// automatic indexing behavior
		if propertyValBool {
			field := bluge.NewKeywordField(pathString, "T")
			if sortablePaths[pathString] {
				field.Sortable()
			}
			doc.AddField(field)
		} else {
			field := bluge.NewKeywordField(pathString, "F")
			if sortablePaths[pathString] {
				field.Sortable()
			}
			doc.AddField(field)
		}

	case reflect.Struct:
		switch property := property.(type) {
		case time.Time:
			// don't descend into the time struct
			field := bluge.NewDateTimeField(pathString, property)
			if sortablePaths[pathString] {
				field.Sortable()
			}
			doc.AddField(field)

		default:
			BlugeWalkDocument(property, path, sortablePaths, doc)
		}
	case reflect.Map, reflect.Slice:
		BlugeWalkDocument(property, path, sortablePaths, doc)
	case reflect.Ptr:
		if !propertyValue.IsNil() {
			BlugeWalkDocument(property, path, sortablePaths, doc)
		}
	default:
		BlugeWalkDocument(property, path, sortablePaths, doc)
	}
}

func blugeParseTagName(tag string) string {
	if idx := strings.Index(tag, ","); idx != -1 {
		return tag[:idx]
	}
	return tag
}

func blugeParseDateTime(input string) (time.Time, error) {
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05", // rfc3339NoTimezone
		"2006-01-02 15:04:05", // rfc3339NoTimezoneNoT
		"2006-01-02",          // rfc3339NoTime
	}
	for _, layout := range layouts {
		rv, err := time.Parse(layout, input)
		if err == nil {
			return rv, nil
		}
	}
	return time.Time{}, fmt.Errorf("invalid date time")
}

type ValidatableQuery interface {
	Validate() error
}

var BlugeKeywordAnalyzer = analyzer.NewKeywordAnalyzer()

func ParseQueryString(query string) (bluge.Query, error) {
	// Ensure that * matches all documents
	if query == "*" {
		return bluge.NewMatchAllQuery(), nil
	}
	opt := queryStr.DefaultOptions().WithDefaultAnalyzer(BlugeKeywordAnalyzer)
	return queryStr.ParseQueryString(query, opt)
}

type constantSimilarity struct{}

func (c constantSimilarity) ComputeNorm(_ int) float32 {
	return 0
}

func (c constantSimilarity) Scorer(boost float64, _ segment.CollectionStats, _ segment.TermStats) search.Scorer {
	return similarity.ConstantScorer(boost)
}

func BlugeInMemoryConfig() bluge.Config {
	cfg := bluge.InMemoryOnlyConfig()
	cfg.DefaultSimilarity = constantSimilarity{}
	cfg.DefaultSearchAnalyzer = BlugeKeywordAnalyzer
	return cfg
}
