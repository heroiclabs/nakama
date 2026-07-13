'use strict';

// Builds test/fixtures/canvas_qti_sample.zip — a Canvas-flavored QTI 1.2 package
// with 2 importable MCQs, 1 essay (skipped), 1 multi-answer (skipped).
// Run: node test/fixtures/make-qti-fixture.js

const path = require('path');
const AdmZip = require('adm-zip');

const ASSESSMENT_XML = `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2">
  <assessment ident="g0001" title="World Capitals Quiz">
    <section ident="root_section">
      <item ident="i0001" title="Capital of France">
        <itemmetadata>
          <qtimetadata>
            <qtimetadatafield>
              <fieldlabel>question_type</fieldlabel>
              <fieldentry>multiple_choice_question</fieldentry>
            </qtimetadatafield>
          </qtimetadata>
        </itemmetadata>
        <presentation>
          <material>
            <mattext texttype="text/html">&lt;div&gt;&lt;p&gt;What is the capital of &lt;strong&gt;France&lt;/strong&gt;?&lt;/p&gt;&lt;/div&gt;</mattext>
          </material>
          <response_lid ident="response1" rcardinality="Single">
            <render_choice>
              <response_label ident="1001"><material><mattext texttype="text/plain">London</mattext></material></response_label>
              <response_label ident="1002"><material><mattext texttype="text/plain">Paris</mattext></material></response_label>
              <response_label ident="1003"><material><mattext texttype="text/plain">Berlin</mattext></material></response_label>
              <response_label ident="1004"><material><mattext texttype="text/plain">Madrid</mattext></material></response_label>
            </render_choice>
          </response_lid>
        </presentation>
        <resprocessing>
          <outcomes><decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/></outcomes>
          <respcondition continue="No">
            <conditionvar><varequal respident="response1">1002</varequal></conditionvar>
            <setvar action="Set" varname="SCORE">100</setvar>
          </respcondition>
        </resprocessing>
        <itemfeedback ident="general_fb">
          <flow_mat><material><mattext texttype="text/plain">Paris has been the capital since 987 AD.</mattext></material></flow_mat>
        </itemfeedback>
      </item>
      <item ident="i0002" title="Capital of Japan">
        <itemmetadata>
          <qtimetadata>
            <qtimetadatafield>
              <fieldlabel>question_type</fieldlabel>
              <fieldentry>multiple_choice_question</fieldentry>
            </qtimetadatafield>
          </qtimetadata>
        </itemmetadata>
        <presentation>
          <material><mattext texttype="text/plain">What is the capital of Japan?</mattext></material>
          <response_lid ident="response1" rcardinality="Single">
            <render_choice>
              <response_label ident="2001"><material><mattext texttype="text/plain">Kyoto</mattext></material></response_label>
              <response_label ident="2002"><material><mattext texttype="text/plain">Osaka</mattext></material></response_label>
              <response_label ident="2003"><material><mattext texttype="text/plain">Tokyo</mattext></material></response_label>
            </render_choice>
          </response_lid>
        </presentation>
        <resprocessing>
          <outcomes><decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/></outcomes>
          <respcondition continue="No">
            <conditionvar><varequal respident="response1">2003</varequal></conditionvar>
            <setvar action="Set" varname="SCORE">100</setvar>
          </respcondition>
        </resprocessing>
      </item>
      <item ident="i0003" title="Essay item (skip)">
        <itemmetadata>
          <qtimetadata>
            <qtimetadatafield>
              <fieldlabel>question_type</fieldlabel>
              <fieldentry>essay_question</fieldentry>
            </qtimetadatafield>
          </qtimetadata>
        </itemmetadata>
        <presentation>
          <material><mattext texttype="text/plain">Describe the geography of Europe.</mattext></material>
          <response_str ident="response1" rcardinality="Single"><render_fib/></response_str>
        </presentation>
      </item>
      <item ident="i0004" title="Multi answer (skip)">
        <itemmetadata>
          <qtimetadata>
            <qtimetadatafield>
              <fieldlabel>question_type</fieldlabel>
              <fieldentry>multiple_answers_question</fieldentry>
            </qtimetadatafield>
          </qtimetadata>
        </itemmetadata>
        <presentation>
          <material><mattext texttype="text/plain">Select all EU capitals.</mattext></material>
          <response_lid ident="response1" rcardinality="Multiple">
            <render_choice>
              <response_label ident="4001"><material><mattext texttype="text/plain">Paris</mattext></material></response_label>
              <response_label ident="4002"><material><mattext texttype="text/plain">Oslo</mattext></material></response_label>
            </render_choice>
          </response_lid>
        </presentation>
      </item>
    </section>
  </assessment>
</questestinterop>
`;

const MANIFEST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="g0001_manifest" xmlns="http://www.imsglobal.org/xsd/imsccv1p1/imscp_v1p1">
  <metadata>
    <schema>IMS Content</schema>
    <schemaversion>1.1.3</schemaversion>
  </metadata>
  <organizations/>
  <resources>
    <resource identifier="g0001" type="imsqti_xmlv1p2" href="g0001/g0001.xml">
      <file href="g0001/g0001.xml"/>
    </resource>
  </resources>
</manifest>
`;

function buildQtiFixture() {
  const zip = new AdmZip();
  zip.addFile('imsmanifest.xml', Buffer.from(MANIFEST_XML, 'utf8'));
  zip.addFile('g0001/g0001.xml', Buffer.from(ASSESSMENT_XML, 'utf8'));
  return zip.toBuffer();
}

module.exports = { buildQtiFixture };

if (require.main === module) {
  const out = path.join(__dirname, 'canvas_qti_sample.zip');
  require('fs').writeFileSync(out, buildQtiFixture());
  console.log('wrote', out);
}
