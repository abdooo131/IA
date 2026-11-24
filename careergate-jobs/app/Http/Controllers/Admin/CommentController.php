<?php

namespace App\Http\Controllers\Admin;

use App\Http\Controllers\Controller;
use App\Models\Application;
use App\Models\Comment;
use Illuminate\Http\RedirectResponse;
use Illuminate\Http\Request;

class CommentController extends Controller
{
    public function store(Request $request, Application $application): RedirectResponse
    {
        $data = $request->validate(['body' => ['required', 'string', 'min:1', 'max:2000']]);

        $application->comments()->create(['user_id' => $request->user()->id, 'body' => $data['body']]);

        return redirect()->to(route('admin.applications.show', $application).'#comments')
            ->with('status', __('admin.application.comment_added'));
    }

    public function destroy(Request $request, Comment $comment): RedirectResponse
    {
        $user = $request->user();
        abort_unless($user->isAdmin() || $comment->user_id === $user->id, 403);

        $applicationId = $comment->application_id;
        $comment->delete();

        return redirect()->to(route('admin.applications.show', $applicationId).'#comments')
            ->with('status', __('admin.application.comment_deleted'));
    }
}
