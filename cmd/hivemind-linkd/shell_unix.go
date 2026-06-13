//go:build unix

package main

import "syscall"

// Run each shell in its own process group so interrupt/terminate reach the
// command the shell is currently running, not just the shell itself.
func shellSysProcAttr() *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setpgid: true}
}

func shellInterruptGroup(pid int) error {
	return syscall.Kill(-pid, syscall.SIGINT)
}

func shellTerminateGroup(pid int) error {
	return syscall.Kill(-pid, syscall.SIGTERM)
}
