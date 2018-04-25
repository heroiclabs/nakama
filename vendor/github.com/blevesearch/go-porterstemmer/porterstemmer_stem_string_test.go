package porterstemmer



import (
	"bufio"
	"io/ioutil"
	"net/http"
	"os"
	"strings"
    "testing"
)



func TestStemString(t *testing.T) {

	testDataDirName := "testdata"

	_, err := os.Stat(testDataDirName)
	if nil != err {
		_ = os.Mkdir(testDataDirName, 0755)
	}
	_, err = os.Stat(testDataDirName)
	if nil != err {
		t.Errorf("The test data folder ([%s]) does not exists (and could not create it). Received error: [%v]", testDataDirName, err)
/////// RETURN
		return
	}


	vocFileName := testDataDirName + "/voc.txt"
	_, err = os.Stat(vocFileName)
	if nil != err {

		vocHref := "http://tartarus.org/martin/PorterStemmer/voc.txt"

		resp, err := http.Get(vocHref)
		if nil != err {
			t.Errorf("Could not download test file (from web) from URL: [%s]. Received error: [%v]", vocHref, err)
/////////// RETURN
			return
		}

		respBody, err := ioutil.ReadAll(resp.Body)
		if nil != err {
			t.Errorf("Error loading the contents of from URL: [%s]. Received error: [%v].", vocHref, err)
/////////// RETURN
			return
		}

		_ = ioutil.WriteFile(vocFileName, respBody, 0644)
		
	}
	vocFd, err := os.Open(vocFileName)
	if nil != err {
		t.Errorf("Could NOT open testdata file: [%s]. Received error: [%v]", vocFileName, err)
/////// RETURN
		return
	}
	defer vocFd.Close()

	voc := bufio.NewReaderSize(vocFd, 1024)



	outFileName := testDataDirName + "/output.txt"
	_, err = os.Stat(outFileName)
	if nil != err {

		outHref := "http://tartarus.org/martin/PorterStemmer/output.txt"

		resp, err := http.Get(outHref)
		if nil != err {
			t.Errorf("Could not download test file (from web) from URL: [%s]. Received error: [%v]", outHref, err)
/////////// RETURN
			return
		}

		respBody, err := ioutil.ReadAll(resp.Body)
		if nil != err {
			t.Errorf("Error loading the contents of from URL: [%s]. Received error: [%v].", outHref, err)
/////////// RETURN
			return
		}

		_ = ioutil.WriteFile(outFileName, respBody, 0644)
		
	}
	outFd, err := os.Open(outFileName)
	if nil != err {
		t.Errorf("Could NOT open testdata file: [%s]. Received error: [%v]", outFileName, err)
/////// RETURN
		return
	}
	defer outFd.Close()

	out := bufio.NewReaderSize(outFd, 1024)



	for {

		vocS, err := voc.ReadString('\n')
		if nil != err {
	/////// BREAK
			break
		}

		vocS = strings.Trim(vocS, "\n\r\t ")



		expected, err := out.ReadString('\n')
		if nil != err {
			t.Errorf("Received unexpected error when trying to read a line from [%s]. Received error: [%v]", outFileName, err)
	/////// BREAK
			break

		}

		expected = strings.Trim(expected, "\n\r\t ")



		actual := StemString(vocS)
		if expected != actual {
			t.Errorf("Input: [%s] -> Actual: [%s]. Expected: [%s]", vocS, actual, expected)
		}
	}
}
