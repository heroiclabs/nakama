package satori

import (
	"context"
	"maps"
	"sync"
	"time"

	"github.com/heroiclabs/nakama-common/runtime"
)

var _ satoriCache[runtime.SatoriLabeled, struct{}] = (*satoriContextCache[runtime.SatoriLabeled, struct{}])(nil)

type liveEventFilters struct {
	startTimeSec   int64
	endTimeSec     int64
	pastRunCount   int32
	futureRunCount int32
}

type satoriContextCacheEntry[T runtime.SatoriLabeled, O comparable] struct {
	containsAll bool
	names       map[string]struct{}
	labels      map[string]struct{}
	optFilter   O
	entryData   map[string]T
}

type satoriContextCache[T runtime.SatoriLabeled, O comparable] struct {
	sync.RWMutex
	enabled bool
	entries map[context.Context]*satoriContextCacheEntry[T, O]
}

func newSatoriContextCache[T runtime.SatoriLabeled, O comparable](ctx context.Context, enabled bool) *satoriContextCache[T, O] {
	if !enabled {
		return &satoriContextCache[T, O]{
			enabled: false,
		}
	}

	sc := &satoriContextCache[T, O]{
		enabled: true,
		entries: make(map[context.Context]*satoriContextCacheEntry[T, O]),
	}

	go func() {
		ticker := time.NewTicker(satoriCacheCleanupInterval)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				sc.Lock()
				for cacheCtx := range sc.entries {
					if cacheCtx.Err() != nil {
						delete(sc.entries, cacheCtx)
					}
				}
				sc.Unlock()
			}
		}
	}()

	return sc
}

func (s *satoriContextCache[T, O]) Get(ctx context.Context, userID string, names, labels []string, optFilters ...O) (values []T, missingNames, missingLabels []string) {
	if !s.enabled {
		return nil, names, labels
	}
	s.RLock()
	entry, found := s.entries[ctx]
	defer s.RUnlock()

	if found && len(optFilters) > 0 {
		if entry.optFilter != optFilters[0] {
			// The cached entry exists but was created with different optional filters, force a cache miss.
			return nil, names, labels
		}
	}

	if !found || (len(names) == 0 && len(labels) == 0 && !entry.containsAll) {
		// Asked for all keys, but they were never fetched, or no cache entries exist for the context.
		// There may be a partially available data set locally, but it's hard to know the scope of
		// anything that might be missing, so the caller needs to fetch all data anyway to be sure.
		return nil, names, labels
	}

	if len(names) > 0 && len(labels) > 0 {
		// Prepare fast lookup maps for requested names and labels.
		namesMap := make(map[string]struct{}, len(names))
		for _, name := range names {
			namesMap[name] = struct{}{}
		}
		labelsMap := make(map[string]struct{}, len(labels))
		for _, label := range labels {
			labelsMap[label] = struct{}{}
			if entry.containsAll {
				// If entry contains all data, no labels can be missing.
				continue
			}
			// Check if any requested labels still need to be fetched.
			if _, ok := entry.labels[label]; !ok {
				missingLabels = append(missingLabels, label)
			}
		}

		// Iterate over all entries and see if they match either the name or the label.
		for name, e := range entry.entryData {
			if _, ok := namesMap[name]; ok {
				delete(namesMap, name)
				values = append(values, e)
				continue
			}
			for _, eLabel := range e.GetLabels() {
				if _, ok := labelsMap[eLabel]; ok {
					values = append(values, e)
					break
				}
			}
		}

		// Check if any requested names still need to be fetched.
		if !entry.containsAll {
			if l := len(namesMap); l > 0 {
				missingNames = make([]string, 0, l)
				for name := range namesMap {
					if len(missingLabels) == 0 {
						// Check if the flag name was requested before and just did not exist in Satori.
						// If there are missing labels we will make a follow-up request to Satori anyway,
						// so see if the flag name has appeared since the last request, but otherwise it
						// is not worth querying Satori just for flag names.
						if _, wasRequested := entry.names[name]; wasRequested {
							// This flag name requested before but is still missing, so it must not exist in
							// Satori. Do not consider it missing, it should not be re-requested for its own
							// sake unless there will be another request to Satori anyway.
							continue
						}
					}
					// We'll be going to Satori for missing labels anyway, try our luck with these flag names too just in case.
					missingNames = append(missingNames, name)
				}
			}
		}
	} else if len(names) > 0 {
		// Only name filters are present.
		for _, name := range names {
			if e, ok := entry.entryData[name]; ok {
				values = append(values, e)
			} else if !entry.containsAll {
				// Data was incomplete and flag name was not in the data, but
				// only consider it missing if it was not already requested.
				if _, wasRequested := entry.names[name]; !wasRequested {
					missingNames = append(missingNames, name)
				}
			}
		}
	} else if len(labels) > 0 {
		// Only label filters are present.
		labelsMap := make(map[string]struct{}, len(labels))
		for _, label := range labels {
			labelsMap[label] = struct{}{}
			if entry.containsAll {
				// If entry contains all data, no labels can be missing.
				continue
			}
			// Check if any requested labels still need to be fetched.
			if _, ok := entry.labels[label]; !ok {
				missingLabels = append(missingLabels, label)
			}
		}

		// Iterate over all entries and see if they match a desired label.
		for _, e := range entry.entryData {
			for _, eLabel := range e.GetLabels() {
				if _, ok := labelsMap[eLabel]; ok {
					values = append(values, e)
					break
				}
			}
		}
	} else {
		// All data is available, and all data has been requested.
		values = make([]T, 0, len(entry.entryData))
		for _, e := range entry.entryData {
			values = append(values, e)
		}
	}

	return values, missingNames, missingLabels
}

func (s *satoriContextCache[T, O]) Add(ctx context.Context, userID string, names, labels []string, values map[string]T, optFilters ...O) {
	if !s.enabled {
		return
	}
	s.Lock()
	entry, ok := s.entries[ctx]
	if !ok {
		entry = &satoriContextCacheEntry[T, O]{
			containsAll: false,
			names:       map[string]struct{}{},
			labels:      map[string]struct{}{},
			entryData:   make(map[string]T, len(values)),
		}
		s.entries[ctx] = entry
	}
	for _, name := range names {
		entry.names[name] = struct{}{}
	}
	for _, label := range labels {
		entry.labels[label] = struct{}{}
	}
	maps.Copy(entry.entryData, values)
	if len(optFilters) > 0 {
		entry.optFilter = optFilters[0]
	}

	s.Unlock()
}

func (s *satoriContextCache[T, O]) SetAll(ctx context.Context, userID string, values map[string]T) {
	if !s.enabled {
		return
	}

	s.Lock()
	s.entries[ctx] = &satoriContextCacheEntry[T, O]{
		containsAll: true,
		entryData:   values,
	}
	s.Unlock()
}
