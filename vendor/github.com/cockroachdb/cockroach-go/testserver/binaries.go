// Copyright 2017 The Cockroach Authors.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
// implied. See the License for the specific language governing
// permissions and limitations under the License.

package testserver

import (
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path"
	"path/filepath"
	"regexp"
	"runtime"
	"time"
)

const (
	latestSuffix     = "LATEST"
	finishedFileMode = 0555
)

func downloadFile(response *http.Response, filePath string) error {
	output, err := os.OpenFile(filePath, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0200)
	if err != nil {
		return fmt.Errorf("error creating %s: %s", filePath, err)
	}
	defer func() { _ = output.Close() }()

	log.Printf("saving %s to %s, this may take some time", response.Request.URL, filePath)

	if _, err := io.Copy(output, response.Body); err != nil {
		return fmt.Errorf("problem saving %s to %s: %s", response.Request.URL, filePath, err)
	}

	// Download was successful, add the rw bits.
	if err := output.Chmod(finishedFileMode); err != nil {
		return err
	}

	// We explicitly close here to ensure the error is checked; the deferred
	// close above will likely error in this case, but that's harmless.
	return output.Close()
}

var muslRE = regexp.MustCompile(`(?i)\bmusl\b`)

func downloadLatestBinary() (string, error) {
	goos := runtime.GOOS
	if goos == "linux" {
		goos += func() string {
			// Detect which C library is present on the system. See
			// https://unix.stackexchange.com/a/120381.
			cmd := exec.Command("ldd", "--version")
			out, err := cmd.Output()
			if err != nil {
				log.Printf("%s: out=%q err=%s", cmd.Args, out, err)
			} else if muslRE.Match(out) {
				return "-musl"
			}
			return "-gnu"
		}()
	}
	binaryName := fmt.Sprintf("cockroach.%s-%s", goos, runtime.GOARCH)
	if runtime.GOOS == "windows" {
		binaryName += ".exe"
	}
	url := &url.URL{
		Scheme: "https",
		Host:   "edge-binaries.cockroachdb.com",
		Path:   path.Join("cockroach", fmt.Sprintf("%s.%s", binaryName, latestSuffix)),
	}
	log.Printf("GET %s", url)
	response, err := http.Get(url.String())
	if err != nil {
		return "", err
	}
	defer func() { _ = response.Body.Close() }()

	if response.StatusCode != 200 {
		return "", fmt.Errorf("error downloading %s: %d (%s)", url, response.StatusCode, response.Status)
	}

	const contentDisposition = "Content-Disposition"
	_, disposition, err := mime.ParseMediaType(response.Header.Get(contentDisposition))
	if err != nil {
		return "", fmt.Errorf("error parsing %s headers %s: %s", contentDisposition, response.Header, err)
	}

	filename, ok := disposition["filename"]
	if !ok {
		return "", fmt.Errorf("content disposition header %s did not contain filename", disposition)
	}
	localFile := filepath.Join(os.TempDir(), filename)
	for {
		info, err := os.Stat(localFile)
		if os.IsNotExist(err) {
			// File does not exist: download it.
			break
		}
		if err != nil {
			return "", err
		}
		// File already present: check mode.
		if info.Mode().Perm() == finishedFileMode {
			return localFile, nil
		}
		log.Printf("waiting for download of %s", localFile)
		time.Sleep(time.Millisecond * 10)
	}

	if err := downloadFile(response, localFile); err != nil {
		if err := os.Remove(localFile); err != nil {
			log.Printf("failed to remove %s: %s", localFile, err)
		}
		return "", err
	}

	return localFile, nil
}
