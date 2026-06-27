//go:build windows

package main

import (
	"errors"
	"syscall"
)

// The link shell service targets the unix shells HivemindOS machines run;
// Windows builds compile but report the feature as unavailable.
func shellSysProcAttr() *syscall.SysProcAttr {
	return nil
}

func shellInterruptGroup(int) error {
	return errors.ErrUnsupported
}

func shellTerminateGroup(int) error {
	return errors.ErrUnsupported
}
