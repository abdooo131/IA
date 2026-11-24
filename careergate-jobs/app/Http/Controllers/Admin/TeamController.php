<?php

namespace App\Http\Controllers\Admin;

use App\Enums\Role;
use App\Http\Controllers\Controller;
use App\Models\User;
use App\Notifications\TeamInvitation;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Password;
use Illuminate\Support\Str;
use Illuminate\Validation\Rule;

class TeamController extends Controller
{
    public function index()
    {
        return view('admin.team.index', ['members' => User::orderBy('name')->get()]);
    }

    public function store(Request $request): RedirectResponse
    {
        $data = $request->validate([
            'name' => ['required', 'string', 'max:255'],
            'email' => ['required', 'email', 'max:255', 'unique:users,email'],
            'role' => ['required', Rule::in(array_column(Role::cases(), 'value'))],
        ]);

        // The member sets their own password through the reset link we email.
        $user = User::create($data + ['password' => Str::random(40), 'locale' => 'en', 'is_active' => true]);
        $this->sendInvite($user);

        return redirect()->route('admin.team.index')->with('status', __('admin.team.added'));
    }

    public function invite(User $user): RedirectResponse
    {
        $this->sendInvite($user);

        return redirect()->route('admin.team.index')->with('status', __('admin.team.invite_resent', ['email' => $user->email]));
    }

    private function sendInvite(User $user): void
    {
        $token = Password::broker('invites')->createToken($user);
        $user->notify(new TeamInvitation($token));
    }

    public function update(Request $request, User $user): RedirectResponse
    {
        $data = $request->validate([
            'name' => ['sometimes', 'required', 'string', 'max:255'],
            'role' => ['sometimes', 'required', Rule::in(array_column(Role::cases(), 'value'))],
            'is_active' => ['sometimes', 'boolean'],
        ]);

        if (array_key_exists('is_active', $data)) {
            $data['is_active'] = (bool) $data['is_active'];
        }

        if ($user->is($request->user())) {
            if (array_key_exists('is_active', $data) && ! $data['is_active']) {
                return back()->withErrors(['is_active' => __('admin.team.cannot_deactivate_self')]);
            }
            if (isset($data['role']) && $data['role'] !== $user->role->value) {
                return back()->withErrors(['role' => __('admin.team.cannot_change_own_role')]);
            }
        }

        $user->update($data);

        return redirect()->route('admin.team.index')->with('status', __('admin.team.updated'));
    }
}
