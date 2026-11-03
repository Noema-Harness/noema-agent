use crate::appcontainer::{derive_capability_name, derive_package_sid};
use crate::parse_request;
use crate::policy::{
    BackendIdentity, EnvironmentPolicy, FileIdentity, FilesystemPolicy, NetworkMode, NetworkPolicy,
    PathRoot, WindowsCommandPolicyV2,
};
use crate::protocol::{Operation, RequestEnvelope, ResultFrame, parse_readiness_response};
use crate::{handle_request, setup_operation_denied, validate_setup_user_data_path};
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

#[test]
fn appcontainer_capability_names_derive_stable_distinct_read_write_sids() {
    let read_name = "Noema.Read.4eeb0c18e86e40eb";
    let write_name = "Noema.Write.4eeb0c18e86e40eb";
    let read_sid = derive_capability_name(read_name).expect("read capability SID");
    let repeated_read_sid = derive_capability_name(read_name).expect("repeat capability SID");
    let write_sid = derive_capability_name(write_name).expect("write capability SID");

    assert_eq!(read_sid, repeated_read_sid);
    assert_ne!(read_sid, write_sid);
    assert!(read_sid.starts_with("S-1-15-3-"));
    assert!(write_sid.starts_with("S-1-15-3-"));
    assert!(
        derive_package_sid()
            .expect("package SID derivation")
            .starts_with("S-1-15-2-")
    );
    assert_eq!(
        derive_capability_name("Network.Noema.Read.4eeb0c18e86e40eb"),
        Err("appcontainer_capability_name_invalid")
    );
}

#[test]
fn mismatched_network_identity_is_rejected_before_runner_admission() {
    let mut policy = valid_policy();
    policy.network.identity = "another_request_identity".to_string();
    let response = handle_request(RequestEnvelope {
        protocol_version: crate::protocol::PROTOCOL_VERSION,
        request_id: "execution_request_01".to_string(),
        operation: Operation::Execute {
            execution_id: "execution-01".to_string(),
            task_id: "task-01".to_string(),
            tool_call_id: "call-01".to_string(),
            user_data_path: "C:\\Users\\fixture\\AppData\\Roaming\\Noema".to_string(),
            package_sid: derive_package_sid().expect("package SID"),
            policy,
            grants: vec![],
            command: "whoami".to_string(),
            timeout_ms: 1_000,
        },
    });

    assert!(matches!(
        response.result,
        ResultFrame::Denied { code, stage }
            if code == "network_identity_mismatch" && stage == "admission"
    ));
}

#[test]
fn invalid_tool_identity_is_rejected_before_readiness_or_child_creation() {
    let policy = valid_policy();
    let response = handle_request(RequestEnvelope {
        protocol_version: crate::protocol::PROTOCOL_VERSION,
        request_id: "execution_request_01".to_string(),
        operation: Operation::Execute {
            execution_id: "execution-01".to_string(),
            task_id: "task-01".to_string(),
            tool_call_id: "invalid tool identity".to_string(),
            user_data_path: "C:\\Users\\fixture\\AppData\\Roaming\\Noema".to_string(),
            package_sid: derive_package_sid().expect("package SID"),
            policy,
            grants: vec![],
            command: "whoami".to_string(),
            timeout_ms: 1_000,
        },
    });

    assert!(matches!(
        response.result,
        ResultFrame::Denied { code, stage }
            if code == "tool_identity_invalid" && stage == "admission"
    ));
}

#[test]
fn native_admission_rejects_a_workspace_junction_before_readiness() {
    let test_root = create_test_root();
    let target = test_root.join("target");
    let alias = test_root.join("workspace-alias");
    std::fs::create_dir(&target).expect("create junction target");
    let output = std::process::Command::new("cmd.exe")
        .args(["/c", "mklink", "/J"])
        .arg(&alias)
        .arg(&target)
        .output()
        .expect("mklink starts");
    assert!(
        output.status.success(),
        "mklink /J creates fixture junction"
    );

    let mut fixture = execute_fixture_value();
    set_execute_fixture_root(&mut fixture, &alias, &target);
    let request = parse_request(&serde_json::to_vec(&fixture).unwrap())
        .expect("junction policy is valid IPC JSON");
    let response = handle_request(request);
    assert!(matches!(
        response.result,
        ResultFrame::Denied { code, stage }
            if code == "path_reparse_point" && stage == "admission"
    ));

    std::fs::remove_dir(&alias).expect("remove fixture junction");
    std::fs::remove_dir_all(test_root).expect("remove temporary policy tree");
}

#[test]
fn native_admission_rejects_a_changed_file_identity_before_readiness() {
    let test_root = create_test_root();
    let mut fixture = execute_fixture_value();
    set_execute_fixture_root(&mut fixture, &test_root, &test_root);
    let current = fixture["operation"]["policy"]["workspaceRoot"]["fileIdentity"]["fileIndex"]
        .as_str()
        .expect("file index is serialized as decimal text")
        .parse::<u64>()
        .expect("file index fits u64");
    fixture["operation"]["policy"]["workspaceRoot"]["fileIdentity"]["fileIndex"] =
        Value::String(if current == 1 {
            "2".to_string()
        } else {
            (current - 1).to_string()
        });
    let request = parse_request(&serde_json::to_vec(&fixture).unwrap())
        .expect("changed object identity is schema-valid IPC");
    let response = handle_request(request);
    assert!(matches!(
        response.result,
        ResultFrame::Denied { code, stage }
            if code == "path_identity_mismatch" && stage == "admission"
    ));
    std::fs::remove_dir_all(test_root).expect("remove temporary policy directory");
}

#[test]
fn native_write_root_scan_rejects_a_hard_link_before_setup_or_child_creation() {
    let test_root = create_test_root();
    let workspace = test_root.join("workspace");
    std::fs::create_dir(&workspace).expect("create workspace");
    let external_target = test_root.join("outside-target.txt");
    std::fs::write(&external_target, b"outside data").expect("create external target");
    std::fs::hard_link(&external_target, workspace.join("linked.txt"))
        .expect("create workspace hard link");

    let mut fixture = execute_fixture_value();
    set_execute_fixture_root(&mut fixture, &workspace, &workspace);
    let request = parse_request(&serde_json::to_vec(&fixture).unwrap())
        .expect("hard-link policy is valid IPC JSON");
    let Operation::Execute { policy, .. } = request.operation else {
        panic!("fixture must contain execute operation");
    };
    let pins = crate::path_identity::verify_policy_paths(&policy)
        .expect("policy directories are pinned before write-root scanning");
    assert_eq!(
        pins.scan_filesystem_roots(&policy),
        Err("filesystem_root_hardlink_detected")
    );
    drop(pins);
    std::fs::remove_dir_all(test_root).expect("remove hard-link fixture");
}

#[test]
fn native_policy_accepts_a_single_file_read_write_root_and_checks_its_identity() {
    let test_root = create_test_root();
    let workspace = test_root.join("workspace");
    std::fs::create_dir(&workspace).expect("create workspace");
    let external_file = test_root.join("authorized.txt");
    std::fs::write(&external_file, b"authorized file").expect("create authorized file");

    let mut policy = valid_policy();
    set_policy_root(&mut policy, &workspace);
    let external_identity = crate::path_identity::file_identity_for_path(&external_file)
        .expect("single file has a native identity");
    let external_path = external_file.to_string_lossy().into_owned();
    let external_root = || PathRoot {
        path: external_path.clone(),
        file_identity: FileIdentity {
            volume_serial_number: external_identity.volume_serial_number.clone(),
            file_index: external_identity.file_index.clone(),
        },
    };
    policy.filesystem.read_roots.push(external_root());
    policy.filesystem.write_roots.push(external_root());

    let pins = crate::path_identity::verify_policy_paths(&policy)
        .expect("native admission opens directory and file roots");
    assert_eq!(pins.scan_filesystem_roots(&policy), Ok(()));

    drop(pins);
    std::fs::remove_dir_all(test_root).expect("remove single-file policy fixture");
}

#[test]
fn native_policy_rejects_a_hard_linked_single_file_write_root() {
    let test_root = create_test_root();
    let workspace = test_root.join("workspace");
    std::fs::create_dir(&workspace).expect("create workspace");
    let external_file = test_root.join("authorized.txt");
    std::fs::write(&external_file, b"authorized file").expect("create authorized file");
    std::fs::hard_link(&external_file, test_root.join("outside-alias.txt"))
        .expect("create external hard link");

    let mut policy = valid_policy();
    set_policy_root(&mut policy, &workspace);
    let external_identity = crate::path_identity::file_identity_for_path(&external_file)
        .expect("hard-linked file has a native identity");
    let external_path = external_file.to_string_lossy().into_owned();
    let external_root = || PathRoot {
        path: external_path.clone(),
        file_identity: FileIdentity {
            volume_serial_number: external_identity.volume_serial_number.clone(),
            file_index: external_identity.file_index.clone(),
        },
    };
    policy.filesystem.read_roots.push(external_root());
    policy.filesystem.write_roots.push(external_root());

    let pins = crate::path_identity::verify_policy_paths(&policy)
        .expect("native admission opens the file before checking its links");
    assert_eq!(
        pins.scan_filesystem_roots(&policy),
        Err("filesystem_root_hardlink_detected")
    );

    drop(pins);
    std::fs::remove_dir_all(test_root).expect("remove hard-link policy fixture");
}

#[test]
fn native_policy_rejects_a_hard_linked_read_only_capability_root() {
    let test_root = create_test_root();
    let workspace = test_root.join("workspace");
    std::fs::create_dir(&workspace).expect("create workspace");
    let external_file = test_root.join("authorized-read.txt");
    std::fs::write(&external_file, b"authorized data").expect("create authorized file");
    std::fs::hard_link(&external_file, test_root.join("outside-read-alias.txt"))
        .expect("create external hard link");

    let mut policy = valid_policy();
    set_policy_root(&mut policy, &workspace);
    let identity = crate::path_identity::file_identity_for_path(&external_file)
        .expect("hard-linked file has a native identity");
    policy.filesystem.read_roots.push(PathRoot {
        path: external_file.to_string_lossy().into_owned(),
        file_identity: identity,
    });

    let pins = crate::path_identity::verify_policy_paths(&policy)
        .expect("native admission opens the read-only capability root");
    assert_eq!(
        pins.scan_filesystem_roots(&policy),
        Err("filesystem_root_hardlink_detected")
    );

    drop(pins);
    std::fs::remove_dir_all(test_root).expect("remove read hard-link fixture");
}

#[test]
fn native_policy_rejects_a_hard_link_inside_a_read_only_directory_root() {
    let test_root = create_test_root();
    let workspace = test_root.join("workspace");
    let runtime_root = test_root.join("approved-runtime");
    std::fs::create_dir(&workspace).expect("create workspace");
    std::fs::create_dir(&runtime_root).expect("create read-only runtime root");
    let external_target = test_root.join("outside-runtime-target.txt");
    std::fs::write(&external_target, b"outside data").expect("create external target");
    std::fs::hard_link(
        &external_target,
        runtime_root.join("linked-runtime-file.txt"),
    )
    .expect("create hard link inside the read-only root");

    let mut policy = valid_policy();
    set_policy_root(&mut policy, &workspace);
    let identity = crate::path_identity::file_identity_for_path(&runtime_root)
        .expect("read-only directory has a native identity");
    policy.filesystem.read_roots.push(PathRoot {
        path: runtime_root.to_string_lossy().into_owned(),
        file_identity: identity,
    });

    let pins = crate::path_identity::verify_policy_paths(&policy)
        .expect("native admission opens read-only directory roots");
    assert_eq!(
        pins.scan_filesystem_roots(&policy),
        Err("filesystem_root_hardlink_detected")
    );

    drop(pins);
    std::fs::remove_dir_all(test_root).expect("remove read-only directory hard-link fixture");
}

#[test]
fn native_policy_requires_workspace_and_working_directory_to_be_directories() {
    let test_root = create_test_root();
    let workspace_file = test_root.join("not-a-workspace-directory.txt");
    std::fs::write(&workspace_file, b"file").expect("create non-directory workspace");
    let path = workspace_file.to_string_lossy().into_owned();
    let identity = crate::path_identity::file_identity_for_path(&workspace_file)
        .expect("file has a native identity");
    let mut policy = valid_policy();
    policy.workspace_root.path = path.clone();
    policy.workspace_root.file_identity = FileIdentity {
        volume_serial_number: identity.volume_serial_number.clone(),
        file_index: identity.file_index.clone(),
    };
    policy.working_directory.path = path.clone();
    policy.working_directory.file_identity = FileIdentity {
        volume_serial_number: identity.volume_serial_number.clone(),
        file_index: identity.file_index.clone(),
    };
    for root in policy
        .filesystem
        .read_roots
        .iter_mut()
        .chain(policy.filesystem.write_roots.iter_mut())
    {
        root.path = path.clone();
        root.file_identity = FileIdentity {
            volume_serial_number: identity.volume_serial_number.clone(),
            file_index: identity.file_index.clone(),
        };
    }

    assert_eq!(
        crate::path_identity::verify_policy_paths(&policy).err(),
        Some("path_identity_unverified")
    );
    std::fs::remove_dir_all(test_root).expect("remove wrong-root-type fixture");
}

#[test]
fn native_admission_rejects_unsupported_network_policy_mode() {
    let mut policy = valid_policy();
    policy.network.mode = NetworkMode::PromptPerDestination;
    assert_eq!(
        policy.validate("execution_request_01"),
        Err("network_policy_unsupported")
    );
}

#[test]
fn a_valid_serialized_policy_still_cannot_bypass_runner_readiness() {
    let test_root = create_test_root();
    let mut policy = valid_policy();
    set_policy_root(&mut policy, &test_root);
    let response = crate::handle_request(RequestEnvelope {
        protocol_version: crate::protocol::PROTOCOL_VERSION,
        request_id: "execution_request_01".to_string(),
        operation: Operation::Execute {
            execution_id: "execution-01".to_string(),
            task_id: "task-01".to_string(),
            tool_call_id: "call-01".to_string(),
            user_data_path: "C:\\Users\\fixture\\AppData\\Roaming\\Noema".to_string(),
            package_sid: derive_package_sid().expect("package SID"),
            grants: grants_for_policy(&policy),
            policy,
            command: "whoami".to_string(),
            timeout_ms: 1_000,
        },
    });

    assert!(matches!(
        response.result,
        ResultFrame::Denied { code, .. }
            if matches!(
                code.as_str(),
                "os_baseline_unsupported"
                    | "sandbox_setup_unavailable"
                    | "network_filters_unverified"
                    | "runner_not_ready"
            )
    ));
    std::fs::remove_dir_all(test_root).expect("remove temporary policy directory");
}

#[test]
fn serialized_d2_policy_is_validated_before_runner_readiness() {
    let test_root = create_test_root();
    let mut fixture = execute_fixture_value();
    set_execute_fixture_root(&mut fixture, &test_root, &test_root);
    let request = parse_request(&serde_json::to_vec(&fixture).unwrap())
        .expect("complete D2 execute fixture parses through the IPC boundary");
    let Operation::Execute { policy, .. } = &request.operation else {
        panic!("fixture must contain an execute operation");
    };
    assert_eq!(policy.validate(&request.request_id), Ok(()));

    let response = handle_request(request);
    assert!(matches!(
        response.result,
        ResultFrame::Denied { code, stage }
            if stage == "admission"
                && matches!(
                    code.as_str(),
                    "os_baseline_unsupported"
                        | "sandbox_setup_unavailable"
                        | "network_filters_unverified"
                        | "runner_not_ready"
                )
    ));
    std::fs::remove_dir_all(test_root).expect("remove temporary policy directory");
}

#[test]
fn execute_rejects_capability_grants_that_do_not_match_current_policy() {
    let mut fixture = execute_fixture_value();
    fixture["operation"]["grants"][0]["access"] = Value::String("read".to_string());
    let request = parse_request(&serde_json::to_vec(&fixture).unwrap())
        .expect("execute request with a structurally valid but stale grant parses");
    let response = handle_request(request);
    assert!(matches!(
        response.result,
        ResultFrame::Denied { code, stage }
            if code == "acl_grants_mismatch" && stage == "admission"
    ));
}

#[test]
fn serialized_d2_policy_rejects_incomplete_unknown_and_unsupported_identity() {
    let mut missing = execute_fixture_value();
    missing["operation"]["policy"]
        .as_object_mut()
        .expect("policy is an object")
        .remove("environment");
    assert!(parse_request(&serde_json::to_vec(&missing).unwrap()).is_err());

    let mut unknown = execute_fixture_value();
    unknown["operation"]["policy"]["unexpected"] = Value::Bool(true);
    assert!(parse_request(&serde_json::to_vec(&unknown).unwrap()).is_err());

    for (path, value, expected) in [
        (
            &["version"][..],
            Value::from(1),
            "policy_version_unsupported",
        ),
        (
            &["backend", "id"][..],
            Value::from("other-runner"),
            "backend_identity_unsupported",
        ),
        (
            &["backend", "version"][..],
            Value::from("9.9.9"),
            "backend_identity_unsupported",
        ),
        (
            &["requestId"][..],
            Value::from("another_request_identity"),
            "policy_request_identity_mismatch",
        ),
    ] {
        let mut fixture = execute_fixture_value();
        let field = path.last().expect("policy field path is non-empty");
        let parent = path[..path.len() - 1]
            .iter()
            .fold(&mut fixture["operation"]["policy"], |current, segment| {
                &mut current[*segment]
            });
        parent[*field] = value;
        let request = parse_request(&serde_json::to_vec(&fixture).unwrap())
            .expect("unsupported policy is still valid JSON schema");
        let Operation::Execute { policy, .. } = request.operation else {
            panic!("fixture must contain execute operation");
        };
        assert_eq!(policy.validate(&request.request_id), Err(expected));
    }
}

#[test]
fn serialized_ipc_request_enforces_the_size_limit() {
    let oversized = vec![b' '; crate::MAX_REQUEST_BYTES + 1];
    assert!(matches!(
        parse_request(&oversized),
        Err("request_too_large")
    ));
}

#[test]
fn policy_rejects_ambient_read_or_write_modes() {
    let mut policy = valid_policy();
    policy.filesystem.default_deny = false;
    assert_eq!(
        policy.validate("execution_request_01"),
        Err("filesystem_default_deny_required")
    );
}

#[test]
fn policy_rejects_a_path_without_main_process_identity_preflight() {
    let mut policy = valid_policy();
    policy.filesystem.read_roots[0]
        .file_identity
        .file_index
        .clear();
    assert_eq!(
        policy.validate("execution_request_01"),
        Err("path_identity_unverified")
    );
}

#[test]
fn policy_rejects_win32_path_aliases_before_admission() {
    for unsafe_path in [
        "C:\\workspace\\file:stream",
        "C:\\workspace\\trailing.",
        "C:\\workspace\\trailing ",
        "C:\\workspace\\CON.txt",
        "C:\\workspace\\COM¹",
        "C:\\workspace\\bad?name",
        "C:\\workspace\\..\\outside",
    ] {
        let mut policy = valid_policy();
        policy.workspace_root.path = unsafe_path.to_string();
        assert_eq!(
            policy.validate("execution_request_01"),
            Err("path_identity_unverified"),
            "unsafe path must be rejected without echoing it"
        );
    }
}

#[test]
fn policy_requires_workspace_roots_and_confines_the_working_directory() {
    let mut outside = valid_policy();
    outside.working_directory = PathRoot {
        path: "C:\\workspace-sibling".to_string(),
        file_identity: FileIdentity {
            volume_serial_number: "1".to_string(),
            file_index: "1".to_string(),
        },
    };
    assert_eq!(
        outside.validate("execution_request_01"),
        Err("working_directory_outside_workspace")
    );

    let mut missing_workspace_grant = valid_policy();
    missing_workspace_grant.filesystem.write_roots[0].path = "C:\\other-workspace".to_string();
    assert_eq!(
        missing_workspace_grant.validate("execution_request_01"),
        Err("filesystem_policy_invalid")
    );
}

#[test]
fn current_policy_binds_one_mode_specific_sid_to_every_read_root() {
    let mut policy = valid_policy();
    let external = PathRoot {
        path: "D:\\reference".to_string(),
        file_identity: FileIdentity {
            volume_serial_number: "55".to_string(),
            file_index: "202".to_string(),
        },
    };
    policy.filesystem.read_roots.push(external.clone());
    let workspace = policy.workspace_root.path.clone();
    let workspace_identity = policy.workspace_root.file_identity.clone();
    let grants = vec![
        crate::policy::AclGrant {
            path: workspace,
            file_identity: workspace_identity,
            capability_name:
                "Noema.Write.1111111111111111111111111111111111111111111111111111111111111111"
                    .to_string(),
            access: crate::policy::FilesystemAccessMode::Write,
            is_directory: true,
        },
        crate::policy::AclGrant {
            path: external.path.clone(),
            file_identity: external.file_identity.clone(),
            capability_name:
                "Noema.Read.2222222222222222222222222222222222222222222222222222222222222222"
                    .to_string(),
            access: crate::policy::FilesystemAccessMode::Read,
            is_directory: true,
        },
    ];
    assert_eq!(
        policy.verified_capability_names(&grants),
        Ok(vec![
            "Noema.Write.1111111111111111111111111111111111111111111111111111111111111111"
                .to_string(),
            "Noema.Read.2222222222222222222222222222222222222222222222222222222222222222"
                .to_string(),
        ])
    );

    let mut stale_access = grants.clone();
    stale_access[1].access = crate::policy::FilesystemAccessMode::Write;
    assert_eq!(
        policy.verified_capability_names(&stale_access),
        Err("acl_grants_mismatch")
    );
    let mut stale_identity = grants.clone();
    stale_identity[1].file_identity.file_index = "303".to_string();
    assert_eq!(
        policy.verified_capability_names(&stale_identity),
        Err("acl_grants_mismatch")
    );
    let mut duplicate_sid = grants.clone();
    duplicate_sid[1].capability_name = duplicate_sid[0].capability_name.clone();
    assert_eq!(
        policy.verified_capability_names(&duplicate_sid),
        Err("acl_grants_mismatch")
    );
    assert_eq!(
        policy.verified_capability_names(&grants[..1]),
        Err("acl_grants_mismatch")
    );
}

#[test]
fn policy_request_identity_must_match_the_ipc_envelope() {
    let mut policy = valid_policy();
    policy.request_id = "another_request_identity".to_string();
    assert_eq!(
        policy.validate("execution_request_01"),
        Err("policy_request_identity_mismatch")
    );
}

#[test]
fn probe_reports_capability_flags_as_disabled_until_enforcement_exists() {
    let capabilities = crate::protocol::Capabilities::disabled();
    assert!(
        !capabilities.filesystem_default_deny
            && !capabilities.filesystem_read_allowlist
            && !capabilities.filesystem_write_allowlist
            && !capabilities.path_identity_validation
            && !capabilities.working_directory_confinement
            && !capabilities.environment_confinement
            && !capabilities.network_default_deny
            && !capabilities.identity_bound_network_broker
            && !capabilities.job_process_tree
            && !capabilities.bounded_stdio
    );
}

#[test]
fn incomplete_setup_probe_serializes_typed_blockers_and_never_reports_ready() {
    let probe = crate::not_ready_probe(crate::protocol::PlatformInfo {
        major: 10,
        minor: 0,
        build: 19_045,
        ubr: 7_807,
        architecture: "x64".to_string(),
    });
    let json = serde_json::to_value(probe).expect("probe serializes");

    assert_eq!(json["type"], "probe");
    assert_eq!(json["ready"], false);
    assert_eq!(json["setupStatus"], "not_implemented");
    assert_eq!(json["networkFilterStatus"], "not_verified");
    assert_eq!(json["blockers"][0], "runner_implementation_incomplete");
    assert_eq!(json["blockers"][1], "sandbox_setup_unavailable");
    assert_eq!(json["blockers"][2], "network_filters_unverified");
    assert_eq!(json["capabilities"]["filesystemDefaultDeny"], false);
    assert_eq!(json["platform"]["build"], 19_045);
    assert_eq!(json["platform"]["ubr"], 7_807);
}

#[test]
fn request_protocol_rejects_unknown_fields() {
    let parsed = serde_json::from_str::<RequestEnvelope>(
        r#"{"protocolVersion":6,"requestId":"execution_request_01","operation":{"type":"probe","extra":true}}"#,
    );
    assert!(parsed.is_err());
}

#[test]
fn acl_protocol_operations_are_strictly_versioned_and_evidence_is_serializable() {
    let mut request = execute_fixture_value();
    request["operation"] = serde_json::json!({
        "type": "verify_filesystem_root_acls",
        "grants": [{
            "path": request["operation"]["policy"]["workspaceRoot"]["path"].clone(),
            "fileIdentity": request["operation"]["policy"]["workspaceRoot"]["fileIdentity"].clone(),
            "capabilityName": "Noema.Write.1111111111111111111111111111111111111111111111111111111111111111",
            "access": "write",
            "isDirectory": true
        }]
    });
    assert!(matches!(
        parse_request(&serde_json::to_vec(&request).unwrap())
            .expect("strict ACL verification request parses")
            .operation,
        Operation::VerifyFilesystemRootAcls { .. }
    ));

    request["operation"]["policy"] = Value::Object(Default::default());
    assert!(parse_request(&serde_json::to_vec(&request).unwrap()).is_err());

    request["operation"]
        .as_object_mut()
        .unwrap()
        .remove("policy");
    request["operation"]["unexpected"] = Value::Bool(true);
    assert!(parse_request(&serde_json::to_vec(&request).unwrap()).is_err());

    let response = crate::protocol::ResponseEnvelope {
        protocol_version: crate::protocol::PROTOCOL_VERSION,
        request_id: Some("execution_request_01".to_string()),
        result: ResultFrame::AclEvidence {
            backend_id: crate::protocol::BACKEND_ID.to_string(),
            backend_version: env!("CARGO_PKG_VERSION").to_string(),
            evidence: vec![crate::policy::VerifiedAclGrantEvidence {
                volume_serial_number: "1".to_string(),
                file_index: "2".to_string(),
                capability_name:
                    "Noema.Write.1111111111111111111111111111111111111111111111111111111111111111"
                        .to_string(),
                access: crate::policy::FilesystemAccessMode::Write,
                object_count: 1,
                acl_verified_count: 1,
                tree_digest: "00".repeat(32),
                inheritance_verified: true,
            }],
        },
    };
    let json = serde_json::to_value(response).expect("ACL evidence response serializes");
    assert_eq!(json["result"]["type"], "acl_evidence");
    assert_eq!(json["result"]["backendId"], crate::protocol::BACKEND_ID);
    assert_eq!(json["result"]["backendVersion"], env!("CARGO_PKG_VERSION"));
    assert_eq!(json["result"]["evidence"][0]["aclVerifiedCount"], 1);
}

#[test]
fn readiness_fixture_accepts_only_a_complete_current_report() {
    assert_eq!(
        parse_readiness_response(READY_READINESS_FIXTURE, "execution_request_01"),
        Ok(())
    );
}

#[test]
fn readiness_rejects_each_missing_required_field() {
    for path in [
        &["result", "backendVersion"][..],
        &["result", "policyVersion"][..],
        &["result", "ready"][..],
        &["result", "setupStatus"][..],
        &["result", "networkFilterStatus"][..],
        &["result", "capabilities", "jobProcessTree"][..],
        &["result", "platform", "ubr"][..],
    ] {
        let mut fixture = readiness_fixture_value();
        remove_json_field(&mut fixture, path);
        assert_eq!(
            parse_readiness_response(&fixture.to_string(), "execution_request_01"),
            Err("readiness_response_invalid"),
            "missing readiness field must reject: {}",
            path.join(".")
        );
    }
}

#[test]
fn readiness_rejects_unsupported_protocol_helper_and_policy_versions() {
    assert_readiness_rejected(
        &["protocolVersion"],
        serde_json::json!(0),
        "protocol_version_unsupported",
    );
    assert_readiness_rejected(
        &["result", "backendVersion"],
        serde_json::json!("0.0.9"),
        "helper_version_unsupported",
    );
    assert_readiness_rejected(
        &["result", "policyVersion"],
        serde_json::json!(0),
        "policy_version_unsupported",
    );
}

#[test]
fn readiness_rejects_old_windows_build_and_security_ubr() {
    assert_readiness_rejected(
        &["result", "platform", "build"],
        serde_json::json!(19_044),
        "os_baseline_unsupported",
    );
    assert_readiness_rejected(
        &["result", "platform", "ubr"],
        serde_json::json!(7_806),
        "os_baseline_unsupported",
    );
}

#[test]
fn readiness_rejects_incomplete_setup_filters_and_missing_capabilities() {
    assert_readiness_rejected(
        &["result", "setupStatus"],
        serde_json::json!("incomplete"),
        "sandbox_setup_unavailable",
    );
    assert_readiness_rejected(
        &["result", "networkFilterStatus"],
        serde_json::json!("failed"),
        "network_filters_unverified",
    );
    assert_readiness_rejected(
        &["result", "capabilities", "jobProcessTree"],
        serde_json::json!(false),
        "required_capability_missing",
    );
    assert_readiness_rejected(
        &["result", "ready"],
        serde_json::json!(false),
        "runner_not_ready",
    );
    assert_readiness_rejected(
        &["result", "blockers"],
        serde_json::json!(["runner_implementation_incomplete"]),
        "runner_not_ready",
    );
}

#[test]
fn readiness_rejects_a_response_for_a_different_request() {
    assert_eq!(
        parse_readiness_response(READY_READINESS_FIXTURE, "another_request_identity"),
        Err("readiness_request_identity_mismatch")
    );

    let mut fixture = readiness_fixture_value();
    fixture
        .as_object_mut()
        .expect("fixture envelope is an object")
        .remove("requestId");
    assert_eq!(
        parse_readiness_response(&fixture.to_string(), "execution_request_01"),
        Err("readiness_request_identity_mismatch")
    );
}

#[test]
fn unsupported_protocol_versions_are_denied_before_operation_dispatch() {
    let response = crate::handle_request(RequestEnvelope {
        protocol_version: 2,
        request_id: "execution_request_01".to_string(),
        operation: Operation::Probe {},
    });

    assert!(matches!(
        response.result,
        ResultFrame::Denied { code, stage }
            if code == "protocol_version_unsupported" && stage == "protocol"
    ));
}

pub(crate) fn valid_policy() -> WindowsCommandPolicyV2 {
    let root = || PathRoot {
        path: "C:\\workspace".to_string(),
        file_identity: FileIdentity {
            volume_serial_number: "1".to_string(),
            file_index: "1".to_string(),
        },
    };
    WindowsCommandPolicyV2 {
        version: 2,
        backend: BackendIdentity {
            id: crate::protocol::BACKEND_ID.to_string(),
            version: "0.1.0".to_string(),
        },
        request_id: "execution_request_01".to_string(),
        workspace_root: root(),
        filesystem: FilesystemPolicy {
            read_roots: vec![root()],
            write_roots: vec![root()],
            default_deny: true,
        },
        working_directory: root(),
        environment: EnvironmentPolicy {
            inherit: false,
            allow_names: vec![
                "SystemRoot".to_string(),
                "WINDIR".to_string(),
                "TEMP".to_string(),
                "TMP".to_string(),
                "PATH".to_string(),
            ],
        },
        network: NetworkPolicy {
            mode: NetworkMode::Deny,
            identity: "execution_request_01".to_string(),
        },
    }
}

fn create_test_root() -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock after Unix epoch")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("noema-runner-policy-{nonce}"));
    std::fs::create_dir(&path).expect("create temporary policy directory");
    path
}

fn set_policy_root(policy: &mut WindowsCommandPolicyV2, path: &Path) {
    let path = path.to_string_lossy().into_owned();
    let identity = crate::path_identity::file_identity_for_directory(Path::new(&path))
        .expect("test directory has a native file identity");
    policy.workspace_root.path = path.clone();
    policy.workspace_root.file_identity = identity;
    for root in policy
        .filesystem
        .read_roots
        .iter_mut()
        .chain(policy.filesystem.write_roots.iter_mut())
    {
        root.path = path.clone();
        root.file_identity = crate::path_identity::file_identity_for_directory(Path::new(&path))
            .expect("test directory has a native file identity");
    }
    policy.working_directory.path = path.clone();
    policy.working_directory.file_identity =
        crate::path_identity::file_identity_for_directory(Path::new(&path))
            .expect("test directory has a native file identity");
}

fn grants_for_policy(policy: &WindowsCommandPolicyV2) -> Vec<crate::policy::AclGrant> {
    policy
        .filesystem
        .read_roots
        .iter()
        .enumerate()
        .map(|(index, root)| {
            let key = root.path.to_ascii_lowercase();
            let access = if policy
                .filesystem
                .write_roots
                .iter()
                .any(|write_root| write_root.path.to_ascii_lowercase() == key)
            {
                crate::policy::FilesystemAccessMode::Write
            } else {
                crate::policy::FilesystemAccessMode::Read
            };
            crate::policy::AclGrant {
                path: root.path.clone(),
                file_identity: root.file_identity.clone(),
                capability_name: format!("Noema.Write.{index:064x}"),
                access,
                is_directory: true,
            }
        })
        .collect()
}

fn set_execute_fixture_root(fixture: &mut Value, path: &Path, identity_path: &Path) {
    let path = path.to_string_lossy().into_owned();
    let identity = crate::path_identity::file_identity_for_directory(identity_path)
        .expect("identity source has a native file identity");
    let policy = &mut fixture["operation"]["policy"];
    policy["workspaceRoot"]["path"] = Value::String(path.clone());
    policy["workspaceRoot"]["fileIdentity"] =
        serde_json::to_value(&identity).expect("file identity serializes");
    policy["workingDirectory"]["path"] = Value::String(path.clone());
    policy["workingDirectory"]["fileIdentity"] =
        serde_json::to_value(&identity).expect("file identity serializes");
    for key in ["readRoots", "writeRoots"] {
        for root in policy["filesystem"][key]
            .as_array_mut()
            .expect("root list exists")
        {
            root["path"] = Value::String(path.clone());
            root["fileIdentity"] =
                serde_json::to_value(&identity).expect("file identity serializes");
        }
    }
    for grant in fixture["operation"]["grants"]
        .as_array_mut()
        .expect("grant list exists")
    {
        grant["path"] = Value::String(path.clone());
        grant["fileIdentity"] = serde_json::to_value(&identity).expect("identity serializes");
        grant["isDirectory"] = Value::Bool(true);
    }
}

const SERIALIZED_EXECUTE_FIXTURE: &str = r#"{
    "protocolVersion": 6,
    "requestId": "execution_request_01",
    "operation": {
        "type": "execute",
        "executionId": "execution-01",
        "taskId": "task-01",
        "toolCallId": "call-01",
        "userDataPath": "C:\\Users\\fixture\\AppData\\Roaming\\Noema",
        "policy": {
            "version": 2,
            "backend": {
                "id": "noema-codex-windows",
                "version": "0.1.0"
            },
            "requestId": "execution_request_01",
            "workspaceRoot": {
                "path": "C:\\workspace",
                "fileIdentity": { "volumeSerialNumber": "1", "fileIndex": "1" }
            },
            "filesystem": {
                "readRoots": [{
                    "path": "C:\\workspace",
                    "fileIdentity": { "volumeSerialNumber": "1", "fileIndex": "1" }
                }],
                "writeRoots": [{
                    "path": "C:\\workspace",
                    "fileIdentity": { "volumeSerialNumber": "1", "fileIndex": "1" }
                }],
                "defaultDeny": true
            },
            "workingDirectory": {
                "path": "C:\\workspace\\src",
                "fileIdentity": { "volumeSerialNumber": "1", "fileIndex": "1" }
            },
            "environment": {
                "inherit": false,
                "allowNames": ["SystemRoot", "WINDIR", "TEMP", "TMP", "PATH"]
            },
            "network": {
                "mode": "deny",
                "identity": "execution_request_01"
            }
        },
        "grants": [{
            "path": "C:\\workspace",
            "fileIdentity": { "volumeSerialNumber": "1", "fileIndex": "1" },
            "capabilityName": "Noema.Write.1111111111111111111111111111111111111111111111111111111111111111",
            "access": "write",
            "isDirectory": true
        }],
        "command": "whoami",
        "timeoutMs": 1000
    }
}"#;

fn execute_fixture_value() -> Value {
    let mut value: Value = serde_json::from_str(SERIALIZED_EXECUTE_FIXTURE)
        .expect("static serialized execute fixture is valid JSON");
    value["operation"]["packageSid"] =
        Value::String(derive_package_sid().expect("current AppContainer package SID"));
    value
}

const READY_READINESS_FIXTURE: &str = r#"{
    "protocolVersion": 6,
    "requestId": "execution_request_01",
    "result": {
        "type": "probe",
        "backendId": "noema-codex-windows",
        "backendVersion": "0.1.0",
        "policyVersion": 2,
        "ready": true,
        "blockers": [],
        "setupStatus": "ready",
        "networkFilterStatus": "ready",
        "capabilities": {
            "filesystemDefaultDeny": true,
            "filesystemReadAllowlist": true,
            "filesystemWriteAllowlist": true,
            "pathIdentityValidation": true,
            "workingDirectoryConfinement": true,
            "environmentConfinement": true,
            "networkDefaultDeny": true,
            "identityBoundNetworkBroker": true,
            "jobProcessTree": true,
            "boundedStdio": true
        },
        "platform": {
            "major": 10,
            "minor": 0,
            "build": 19045,
            "ubr": 7807,
            "architecture": "x86_64"
        }
    }
}"#;

fn readiness_fixture_value() -> Value {
    serde_json::from_str(READY_READINESS_FIXTURE).expect("static readiness fixture is valid JSON")
}

fn remove_json_field(value: &mut Value, path: &[&str]) {
    let (field, parents) = path.split_last().expect("field path is not empty");
    let parent = parents.iter().fold(value, |current, segment| {
        current
            .get_mut(*segment)
            .expect("fixture path exists while removing field")
    });
    parent
        .as_object_mut()
        .expect("fixture parent is an object")
        .remove(*field)
        .expect("fixture field exists while removing field");
}

fn assert_readiness_rejected(path: &[&str], replacement: Value, expected: &'static str) {
    let mut fixture = readiness_fixture_value();
    let target = path.iter().fold(&mut fixture, |current, segment| {
        current
            .get_mut(*segment)
            .expect("fixture path exists while replacing field")
    });
    *target = replacement;
    assert_eq!(
        parse_readiness_response(&fixture.to_string(), "execution_request_01"),
        Err(expected),
        "readiness fixture must reject {}",
        path.join(".")
    );
}

#[test]
fn sandbox_setup_ipc_schema_is_strict_and_probe_fails_closed() {
    for operation_type in ["reconcile_sandbox_setup", "probe_sandbox_setup"] {
        let request_id = "setup_operation_0001";
        let request = serde_json::json!({
            "protocolVersion": 6,
            "requestId": request_id,
            "operation": {
                "type": operation_type,
                "operationId": request_id,
                "userDataPath": "C:\\Users\\fixture\\AppData\\Roaming\\Noema"
            }
        });
        let parsed = parse_request(&serde_json::to_vec(&request).unwrap())
            .expect("setup request follows the strict operation schema");
        if operation_type == "probe_sandbox_setup" {
            let response = handle_request(parsed);
            if cfg!(windows) {
                assert!(matches!(
                    response.result,
                    ResultFrame::SetupEvidence { evidence, .. }
                        if crate::appcontainer::is_appcontainer_package_sid(&evidence.package_sid)
                ));
            } else {
                assert!(matches!(
                    response.result,
                    ResultFrame::Denied { code, stage }
                        if code == "windows_required" && stage == "setup"
                ));
            }
        } else {
            assert!(matches!(
                parsed.operation,
                Operation::ReconcileSandboxSetup { .. }
            ));
        }

        let mut with_unknown_field = request;
        with_unknown_field["operation"]["secret"] = Value::String("reject-me".to_string());
        assert_eq!(
            parse_request(&serde_json::to_vec(&with_unknown_field).unwrap()).err(),
            Some("request_invalid")
        );
    }
}

#[test]
fn sandbox_setup_operation_identity_must_match_request_identity() {
    let response = handle_request(RequestEnvelope {
        protocol_version: crate::protocol::PROTOCOL_VERSION,
        request_id: "setup_operation_0001".to_string(),
        operation: Operation::ReconcileSandboxSetup {
            operation_id: "setup_operation_0002".to_string(),
            user_data_path: r"C:\Users\fixture\AppData\Roaming\Noema".to_string(),
        },
    });
    assert!(matches!(
        response.result,
        ResultFrame::Denied { code, stage }
            if code == "setup_operation_identity_mismatch" && stage == "setup"
    ));
}

#[test]
fn setup_user_data_path_requires_a_bounded_local_drive_path() {
    assert_eq!(
        validate_setup_user_data_path(r"C:\Users\fixture\AppData\Roaming\Noema"),
        Ok(())
    );
    for path in [
        r"relative\Noema",
        r"\\server\share\Noema",
        r"\\?\C:\Users\fixture\Noema",
        r"C:\Users\fixture\..\Noema",
        r"C:\",
    ] {
        assert_eq!(
            validate_setup_user_data_path(path),
            Err("setup_user_data_path_invalid"),
            "reject unsafe setup root {path}"
        );
    }
    assert_eq!(
        validate_setup_user_data_path(&format!("C:\\{}", "x".repeat(1022))),
        Err("setup_user_data_path_invalid")
    );
}

#[test]
fn restricted_agent_cannot_reenter_native_setup_operations() {
    let response = setup_operation_denied(
        "setup_operation_0001".to_string(),
        "setup_operation_0001".to_string(),
        "runner_caller_restricted",
    );
    assert!(matches!(
        response.result,
        ResultFrame::Denied { code, stage }
            if code == "runner_caller_restricted" && stage == "setup"
    ));
}
