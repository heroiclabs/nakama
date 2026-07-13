<?php
// Run inside a Moodle container:
// php moodle-real-roundtrip.php /path/input.xml /path/output.xml
define('CLI_SCRIPT', true);
require '/opt/bitnami/moodle/config.php';
require_once $CFG->dirroot . '/question/editlib.php';
require_once $CFG->dirroot . '/question/format/xml/format.php';

$USER = get_admin();
\core\session\manager::set_user($USER);

if ($argc !== 3) {
    fwrite(STDERR, "usage: php moodle-real-roundtrip.php INPUT.xml OUTPUT.xml\n");
    exit(2);
}

$input = $argv[1];
$output = $argv[2];
if (!is_readable($input)) {
    fwrite(STDERR, "input is not readable\n");
    exit(2);
}

$course = get_site();
$context = context_course::instance($course->id);
$category = question_get_default_category($context->id);
if (!$category) {
    question_make_default_categories([$context]);
    $category = question_get_default_category($context->id);
}
if (!$category) {
    fwrite(STDERR, "could not create a Moodle question category\n");
    exit(1);
}
$importer = new qformat_xml();
$importer->setCategory($category);
$importer->setCourse($course);
$importer->setContexts([$context]);
$importer->setFilename($input);
$importer->setRealfilename(basename($input));
$importer->setMatchgrades('error');
$importer->setCatfromfile(false);
$importer->setContextfromfile(false);
$importer->setStoponerror(true);

if (!$importer->importpreprocess() || !$importer->importprocess() || !$importer->importpostprocess()) {
    fwrite(STDERR, "Moodle XML import failed\n");
    exit(1);
}

$questions = get_questions_category($category, false, false, true, true);
$proofquestions = array_filter($questions, fn($q) => str_starts_with($q->name, 'P4P5 '));
if (!$proofquestions) {
    fwrite(STDERR, "Moodle imported no P4P5 proof questions\n");
    exit(1);
}
usort($proofquestions, fn($a, $b) => $b->id <=> $a->id);
$proofquestions = [reset($proofquestions)];

$exporter = new qformat_xml();
$exporter->setCourse($course);
$exporter->setContexts([$context]);
$exporter->setQuestions(array_values($proofquestions));
$exporter->setCattofile(false);
$exporter->setContexttofile(false);
if (!$exporter->exportpreprocess()) {
    fwrite(STDERR, "Moodle XML export preprocess failed\n");
    exit(1);
}
$xml = $exporter->exportprocess(false);
file_put_contents($output, $xml);

echo json_encode([
    'moodle_version' => $CFG->version,
    'imported_questions' => count($proofquestions),
    'output_bytes' => strlen($xml),
    'output' => $output,
], JSON_UNESCAPED_SLASHES), PHP_EOL;
