#!/usr/bin/env bash
set -eu

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

cat > "$TMP_DIR/kubectl" <<'FAKE_KUBECTL'
#!/usr/bin/env bash
set -eu

subcommand="${1:-}"
shift || true

case "$subcommand" in
    rollout)
        echo 'Waiting for deployment "intelliverse-nakama" rollout to finish: 1 out of 2 new replicas have been updated...'
        echo 'error: timed out waiting for the condition' >&2
        exit 1
        ;;
    get)
        resource="${1:-}"
        shift || true
        args="$*"
        case "$resource" in
            deployment)
                echo 'NAME                  READY   UP-TO-DATE   AVAILABLE   AGE    CONTAINERS            IMAGES'
                echo 'intelliverse-nakama   2/2     1            2           180d   intelliverse-nakama   fake-image'
                ;;
            rs)
                echo 'NAME                              DESIRED   CURRENT   READY   AGE'
                echo 'intelliverse-nakama-new           1         1         <none>  2026-05-10T20:53:38Z'
                ;;
            pods)
                if [[ "$args" == *"jsonpath"* && "$args" == *"creationTimestamp"* ]]; then
                    echo 'intelliverse-nakama-new-pod 2026-05-10T20:53:38Z'
                elif [[ "$args" == *"jsonpath"* && "$args" == *"metadata.name"* ]]; then
                    echo 'intelliverse-nakama-new-pod'
                else
                    echo 'NAME                           READY   STATUS              RESTARTS   AGE'
                    echo 'intelliverse-nakama-new-pod    0/1     ContainerCreating   0          10m'
                fi
                ;;
            events)
                echo 'LAST SEEN   TYPE      REASON                 OBJECT                         MESSAGE'
                echo '10m         Warning   FailedCreatePodSandBox  pod/intelliverse-nakama-new-pod simulated'
                ;;
            *)
                echo "unexpected kubectl get resource: $resource" >&2
                exit 2
                ;;
        esac
        ;;
    describe)
        if [ "${FAKE_KUBECTL_SCENARIO:-}" = "cni" ]; then
            cat <<'CNI_DESCRIBE'
Containers:
  intelliverse-nakama:
    State:          Waiting
      Reason:       ContainerCreating
Events:
  Type     Reason                  Age   From     Message
  Warning  FailedCreatePodSandBox  10m   kubelet  Failed to create pod sandbox: rpc error: code = Unknown desc = failed to setup network for sandbox "abc": plugin type="aws-cni" name="aws-cni" failed (add): add cmd: failed to assign an IP address to container
CNI_DESCRIBE
        else
            cat <<'GENERIC_DESCRIBE'
Containers:
  intelliverse-nakama:
    State:          Waiting
      Reason:       ContainerCreating
Events:
  Type     Reason   Age   From     Message
  Warning  Failed   10m   kubelet  simulated generic rollout failure
GENERIC_DESCRIBE
        fi
        ;;
    logs)
        echo 'simulated pod logs unavailable'
        ;;
    *)
        echo "unexpected kubectl subcommand: $subcommand" >&2
        exit 2
        ;;
esac
FAKE_KUBECTL
chmod +x "$TMP_DIR/kubectl"

run_case() {
    local scenario="$1"
    local expected_rc="$2"
    local output="$TMP_DIR/${scenario}.out"

    set +e
    PATH="$TMP_DIR:$PATH" FAKE_KUBECTL_SCENARIO="$scenario" \
        "$ROOT_DIR/scripts/smoke-test-js-runtime.sh" cluster aicart intelliverse-nakama \
        >"$output" 2>&1
    local actual_rc=$?
    set -e

    if [ "$actual_rc" -ne "$expected_rc" ]; then
        echo "Expected scenario '$scenario' to exit $expected_rc, got $actual_rc" >&2
        cat "$output" >&2
        exit 1
    fi
}

run_case cni 3
run_case generic 1

echo "smoke-test-js-runtime rollout classification tests passed"
