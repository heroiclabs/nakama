//  Copyright (c) 2016 Marty Schoch

//  Licensed under the Apache License, Version 2.0 (the "License");
//  you may not use this file except in compliance with the
//  License. You may obtain a copy of the License at
//    http://www.apache.org/licenses/LICENSE-2.0
//  Unless required by applicable law or agreed to in writing,
//  software distributed under the License is distributed on an "AS
//  IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either
//  express or implied. See the License for the specific language
//  governing permissions and limitations under the License.

package boltsmat

import (
	"log"
	"os"
	"testing"

	"github.com/mschoch/smat"
)

func TestCrasher(t *testing.T) {
	// paste in your crash here:
	crasher := []byte("N\x00\xcb���\n\xef\x1a\x00\xbd0N\xb9" +
		"a\xaf@\xee\x1e\xd748\xc7\xe9\xed\x02\xfe\xfb\x02\x00\xbd\xbf0N" +
		"\xb9a\xaf@\xee\x1e\xd748\xc7\xe9\xed\x02\xfe\xfbM\xfe\xbd\xbf\xef" +
		"\xbd\xbfｿ\xef\xbd6379788709725" +
		"605625\xbfｿ\xef\xf6\xfe\xf6N\xafN\xf6N\x9b" +
		"J\x88\xac\xd5�\xbf\xbd`�N\xb9NN\xa3\xe2\xd6" +
		"\x11\x8d\x15\xd5ǵ\xc7\xef\xbfｿ\xef\xbd679709" +
		"71251601625\xbfｿ\xef\xf6\xfe\xf6N" +
		"\xafN\xf6N\x9bJ\x88\xac\xd5뿽\xbf\xbd`\xef\xbf\xcaN\xb9" +
		"NN\xa3\xe2\xd6\x11\xd5ǵ")
	// turn on logger
	smat.Logger = log.New(os.Stderr, "smat ", log.LstdFlags)
	// fuzz the crasher input
	smat.Fuzz(&context{}, setup, teardown, actionMap, crasher)
}
