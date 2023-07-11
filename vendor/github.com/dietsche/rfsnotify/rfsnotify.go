// Package rfsnotify implements recursive folder monitoring by wrapping the excellent fsnotify library
package rfsnotify

import (
	"gopkg.in/fsnotify.v1"

	"errors"
	"os"
	"path/filepath"
)

// RWatcher wraps fsnotify.Watcher. When fsnotify adds recursive watches, you should be able to switch your code to use fsnotify.Watcher
type RWatcher struct {
	Events chan fsnotify.Event
	Errors chan error

	done     chan struct{}
	fsnotify *fsnotify.Watcher
	isClosed bool
}

// NewWatcher establishes a new watcher with the underlying OS and begins waiting for events.
func NewWatcher() (*RWatcher, error) {
	fsWatch, err := fsnotify.NewWatcher()
	if err != nil {
		return nil, err
	}

	m := &RWatcher{}
	m.fsnotify = fsWatch
	m.Events = make(chan fsnotify.Event)
	m.Errors = make(chan error)
	m.done = make(chan struct{})

	go m.start()

	return m, nil
}

// Add starts watching the named file or directory (non-recursively).
func (m *RWatcher) Add(name string) error {
	if m.isClosed {
		return errors.New("rfsnotify instance already closed")
	}
	return m.fsnotify.Add(name)
}

// AddRecursive starts watching the named directory and all sub-directories.
func (m *RWatcher) AddRecursive(name string) error {
	if m.isClosed {
		return errors.New("rfsnotify instance already closed")
	}
	if err := m.watchRecursive(name, false); err != nil {
		return err
	}
	return nil
}

// Remove stops watching the the named file or directory (non-recursively).
func (m *RWatcher) Remove(name string) error {
	return m.fsnotify.Remove(name)
}

// RemoveRecursive stops watching the named directory and all sub-directories.
func (m *RWatcher) RemoveRecursive(name string) error {
	if err := m.watchRecursive(name, true); err != nil {
		return err
	}
	return nil
}

// Close removes all watches and closes the events channel.
func (m *RWatcher) Close() error {
	if m.isClosed {
		return nil
	}
	close(m.done)
	m.isClosed = true
	return nil
}

func (m *RWatcher) start() {
	for {
		select {

		case e := <-m.fsnotify.Events:
			s, err := os.Stat(e.Name)
			if err == nil && s != nil && s.IsDir() {
				if e.Op&fsnotify.Create != 0 {
					m.watchRecursive(e.Name, false)
				}
			}
			//Can't stat a deleted directory, so just pretend that it's always a directory and
			//try to remove from the watch list...  we really have no clue if it's a directory or not...
			if e.Op&fsnotify.Remove != 0 {
				m.fsnotify.Remove(e.Name)
			}
			m.Events <- e

		case e := <-m.fsnotify.Errors:
			m.Errors <- e

		case <-m.done:
			m.fsnotify.Close()
			close(m.Events)
			close(m.Errors)
			return
		}
	}
}

// watchRecursive adds all directories under the given one to the watch list.
// this is probably a very racey process. What if a file is added to a folder before we get the watch added?
func (m *RWatcher) watchRecursive(path string, unWatch bool) error {
	err := filepath.Walk(path, func(walkPath string, fi os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if fi.IsDir() {
			if unWatch {
				if err = m.fsnotify.Remove(walkPath); err != nil {
					return err
				}
			} else {
				if err = m.fsnotify.Add(walkPath); err != nil {
					return err
				}
			}
		}
		return nil
	})
	return err
}
